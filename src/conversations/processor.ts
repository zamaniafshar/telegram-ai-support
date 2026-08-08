import {
  ConversationMode,
  MessageProcessingStatus,
  type ConversationJob,
  type PrismaClient,
} from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { GroundedAnswerer } from '../ai/openai.js';
import type { RetrievalService } from '../retrieval/service.js';
import type { HandoffService } from '../handoffs/service.js';
import type { BusinessMessenger } from '../telegram-business/messenger.js';
import type { AdminNotifier } from '../telegram-admin/notifier.js';
import { preModelRoute, shouldHandoffExternalFailure } from './routing.js';
import { millisecondsFrom } from '../utils/time.js';
import { errorCode, safeErrorDetail } from '../utils/errors.js';
import { newId } from '../utils/ids.js';
import { tryAcquireConversationLease } from '../workers/conversation-lease.js';

export class ConversationProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly retrieval: RetrievalService,
    private readonly answerer: GroundedAnswerer,
    private readonly handoffs: HandoffService,
    private readonly messenger: BusinessMessenger,
    private readonly notifier: AdminNotifier,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async runBatch(workerId: string): Promise<number> {
    const candidates = await this.prisma.conversationJob.findMany({
      where: {
        status: {
          in: [MessageProcessingStatus.PENDING, MessageProcessingStatus.PROCESSING],
        },
        processAfter: { lte: new Date() },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
      },
      orderBy: { processAfter: 'asc' },
      take: this.config.worker.batchSize,
      select: { id: true },
    });
    let count = 0;
    for (const candidate of candidates) {
      const job = await this.#claimJob(candidate.id, workerId);
      if (!job) continue;
      if (!(await this.#acquireConversation(job.conversationId, workerId))) {
        await this.#retryJob(job, 'CONVERSATION_BUSY', 250);
        continue;
      }
      count += 1;
      try {
        await this.#process(job);
      } catch (error) {
        await this.#handleFailure(job, error);
      } finally {
        await this.#releaseConversation(job.conversationId, workerId);
      }
    }
    return count;
  }

  async #claimJob(id: string, workerId: string): Promise<ConversationJob | null> {
    const now = new Date();
    const updated = await this.prisma.conversationJob.updateMany({
      where: {
        id,
        status: {
          in: [MessageProcessingStatus.PENDING, MessageProcessingStatus.PROCESSING],
        },
        processAfter: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        status: MessageProcessingStatus.PROCESSING,
        leaseOwner: workerId,
        leaseExpiresAt: millisecondsFrom(now, this.config.worker.leaseMs),
        attempts: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    return this.prisma.conversationJob.findUniqueOrThrow({ where: { id } });
  }

  async #acquireConversation(conversationId: string, workerId: string): Promise<boolean> {
    return tryAcquireConversationLease(
      this.prisma,
      conversationId,
      workerId,
      this.config.worker.leaseMs,
    );
  }

  async #releaseConversation(conversationId: string, workerId: string): Promise<void> {
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, processingLeaseOwner: workerId },
      data: { processingLeaseOwner: null, processingLeaseExpiresAt: null },
    });
  }

  async #process(job: ConversationJob): Promise<void> {
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: job.messageId },
      include: {
        conversation: {
          include: {
            messages: {
              where: { text: { not: null }, deletedAt: null },
              orderBy: { sentAt: 'desc' },
              take: this.config.rag.contextMessages + 1,
            },
          },
        },
      },
    });
    const conversation = message.conversation;
    const customerText = message.text;
    if (!customerText) {
      await this.#complete(job, message.id);
      return;
    }
    if (conversation.mode === ConversationMode.HUMAN) {
      if (this.config.handoff.notifyAdditionalMessages) {
        await this.notifier.additionalCustomerMessage(conversation.id, customerText);
      }
      await this.#complete(job, message.id);
      return;
    }
    if (conversation.mode !== ConversationMode.AI) {
      await this.#retryJob(job, 'CONVERSATION_PENDING_HANDOFF', 1_000);
      return;
    }
    const initialRoute = preModelRoute(customerText);
    if (initialRoute.kind === 'HANDOFF') {
      await this.#recordDecision(job, false, 1, 'Customer explicitly requested a human', [], [], 0);
      await this.#activateHandoff(
        conversation.id,
        'EXPLICIT_HUMAN_REQUEST',
        'Customer requested a human',
        message.id,
      );
      await this.#complete(job, message.id);
      return;
    }

    if (initialRoute.kind === 'SAFE_GREETING') {
      await this.#recordDecision(
        job,
        true,
        1,
        'Safe predefined greeting',
        [],
        [],
        0,
        initialRoute.answer,
      );
      await this.messenger.sendAiAnswer(conversation.id, initialRoute.answer, message.id);
      await this.#complete(job, message.id);
      return;
    }

    const retrieved = await this.retrieval.search(conversation.businessAccountId, customerText);
    if (preModelRoute(customerText, retrieved).kind === 'HANDOFF') {
      await this.#recordDecision(
        job,
        false,
        0,
        'No current knowledge met the retrieval threshold',
        [],
        [],
        0,
      );
      await this.#activateHandoff(
        conversation.id,
        'NO_RELEVANT_KNOWLEDGE',
        'No retrieval result met threshold',
        message.id,
      );
      await this.#complete(job, message.id);
      return;
    }
    const context = conversation.messages
      .filter((contextMessage) => contextMessage.id !== message.id && contextMessage.text)
      .reverse()
      .map((contextMessage) => ({
        senderType: contextMessage.senderType,
        text: (contextMessage.text ?? '').slice(0, 2_000),
        sentAt: contextMessage.sentAt,
      }));
    const decision = await this.answerer.decide({ customerText, retrieved, context });
    await this.#recordDecision(
      job,
      decision.answerable,
      decision.confidence,
      decision.reason,
      decision.supportingChunkIds,
      retrieved.map((item) => ({ chunkId: item.chunkId, score: item.score })),
      decision.latencyMs,
      decision.answer,
      decision.model,
      decision.inputTokens,
      decision.outputTokens,
      decision.totalTokens,
    );
    if (!decision.answerable || !decision.answer) {
      await this.#activateHandoff(
        conversation.id,
        'AI_NOT_ANSWERABLE',
        decision.reason,
        message.id,
      );
      await this.#complete(job, message.id);
      return;
    }
    await this.messenger.sendAiAnswer(conversation.id, decision.answer, message.id);
    await this.#complete(job, message.id);
  }

  async #activateHandoff(
    conversationId: string,
    reasonCode: string,
    detail: string,
    sourceMessageId: string,
  ): Promise<void> {
    const activated = await this.handoffs.activate(conversationId, reasonCode, detail);
    if (!activated.created) return;
    if (this.config.handoff.customerMessageEnabled) {
      await this.messenger
        .sendHandoffAcknowledgement(
          conversationId,
          this.config.handoff.customerMessage,
          sourceMessageId,
        )
        .catch(async (error: unknown) => {
          this.logger.warn(
            { err: error, conversationId },
            'handoff acknowledgement could not be sent',
          );
          await this.prisma.auditLog.create({
            data: {
              id: newId(),
              businessAccountId: activated.conversation.businessAccountId,
              actorType: 'SYSTEM',
              action: 'HANDOFF_ACKNOWLEDGEMENT_FAILED',
              entityType: 'Conversation',
              entityId: conversationId,
              metadata: { errorCode: errorCode(error) },
            },
          });
        });
    }
    await this.notifier.handoffActivated(conversationId);
  }

  async #recordDecision(
    job: ConversationJob,
    answerable: boolean,
    confidence: number,
    reason: string,
    supportingChunkIds: string[],
    retrievalResults: { chunkId: string; score: number }[],
    latencyMs: number,
    answer: string | null = null,
    model = 'policy',
    inputTokens?: number,
    outputTokens?: number,
    totalTokens?: number,
  ): Promise<void> {
    await this.prisma.aiDecisionLog.upsert({
      where: { messageId: job.messageId },
      create: {
        id: newId(),
        conversationId: job.conversationId,
        messageId: job.messageId,
        answerable,
        confidence,
        reason,
        answer,
        supportingChunkIds,
        retrievalResults,
        model,
        promptVersion: 'grounded-v1',
        latencyMs,
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
        ...(totalTokens === undefined ? {} : { totalTokens }),
      },
      update: {
        answerable,
        confidence,
        reason,
        answer,
        supportingChunkIds,
        retrievalResults,
        model,
        latencyMs,
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
        ...(totalTokens === undefined ? {} : { totalTokens }),
      },
    });
  }

  async #complete(job: ConversationJob, messageId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.conversationJob.update({
        where: { id: job.id },
        data: {
          status: MessageProcessingStatus.PROCESSED,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      }),
      this.prisma.message.update({
        where: { id: messageId },
        data: { processingStatus: MessageProcessingStatus.PROCESSED, processingErrorCode: null },
      }),
    ]);
  }

  async #retryJob(job: ConversationJob, code: string, delayMs: number): Promise<void> {
    await this.prisma.conversationJob.update({
      where: { id: job.id },
      data: {
        status: MessageProcessingStatus.PENDING,
        processAfter: millisecondsFrom(new Date(), delayMs),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: code,
      },
    });
  }

  async #handleFailure(job: ConversationJob, error: unknown): Promise<void> {
    const code = errorCode(error);
    if (code === 'CONVERSATION_NOT_AI') {
      await this.#complete(job, job.messageId);
      return;
    }
    const terminalSendFailure = [
      'TELEGRAM_REPLY_WINDOW_EXPIRED',
      'BUSINESS_CONNECTION_DISABLED',
      'BUSINESS_CAN_REPLY_MISSING',
    ].includes(code);
    this.logger.error(
      { err: error, conversationJobId: job.id, attempt: job.attempts },
      'conversation job failed',
    );
    if (!terminalSendFailure && !shouldHandoffExternalFailure(job.attempts, job.maxAttempts)) {
      await this.#retryJob(job, code, 1_000 * 2 ** (job.attempts - 1));
      return;
    }
    await this.prisma.aiDecisionLog.upsert({
      where: { messageId: job.messageId },
      create: {
        id: newId(),
        conversationId: job.conversationId,
        messageId: job.messageId,
        answerable: false,
        confidence: 0,
        reason: 'External dependency repeatedly failed',
        answer: null,
        supportingChunkIds: [],
        retrievalResults: [],
        model: this.config.openai.chatModel,
        promptVersion: 'grounded-v1',
        latencyMs: 0,
        errorCode: code,
      },
      update: {
        answerable: false,
        errorCode: code,
        reason: 'External dependency repeatedly failed',
      },
    });
    await this.#activateHandoff(
      job.conversationId,
      'EXTERNAL_SERVICE_FAILURE',
      code,
      job.messageId,
    ).catch((handoffError: unknown) =>
      this.logger.error(
        { err: handoffError, conversationId: job.conversationId },
        'failure handoff failed',
      ),
    );
    if (terminalSendFailure) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: job.conversationId },
        select: { businessAccountId: true },
      });
      if (conversation) {
        await this.notifier.systemAttention(
          conversation.businessAccountId,
          `ارسال پیام برای گفتگو ${job.conversationId} متوقف شد (${code}). تا پیام جدید مشتری یا اصلاح اتصال، تلاش پیوسته انجام نمی‌شود.`,
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.conversationJob.update({
        where: { id: job.id },
        data: {
          status: MessageProcessingStatus.FAILED,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: code,
          lastErrorDetail: safeErrorDetail(error),
        },
      }),
      this.prisma.message.update({
        where: { id: job.messageId },
        data: { processingStatus: MessageProcessingStatus.FAILED, processingErrorCode: code },
      }),
    ]);
  }
}
