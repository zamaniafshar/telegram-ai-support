import {
  ConversationMode,
  MessageProcessingStatus,
  SenderType,
  type Prisma,
  type ConversationJob,
  type Message,
  type PrismaClient,
} from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { PROMPT_VERSION, type GroundedAnswerer } from '../ai/openai.js';
import type { RetrievalService } from '../retrieval/service.js';
import type { HandoffService } from '../handoffs/service.js';
import type { BusinessMessenger } from '../telegram-business/messenger.js';
import type { AdminNotifier } from '../telegram-admin/notifier.js';
import { preModelRoute, shouldHandoffExternalFailure } from './routing.js';
import { millisecondsFrom } from '../utils/time.js';
import { errorCode, safeErrorDetail } from '../utils/errors.js';
import { newId } from '../utils/ids.js';
import { tryAcquireConversationLease } from '../workers/conversation-lease.js';
import type {
  AiAvailabilityReason,
  AiAvailabilityService,
  QueuePolicy,
} from '../ai/availability.js';

const runnable = [
  MessageProcessingStatus.PENDING,
  MessageProcessingStatus.READY,
  MessageProcessingStatus.WAITING_FOR_AI_AVAILABILITY,
  MessageProcessingStatus.PROCESSING,
] as const;

type BatchJob = ConversationJob & { message: Message };

export class ConversationProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly retrieval: RetrievalService,
    private readonly answerer: GroundedAnswerer,
    private readonly handoffs: HandoffService,
    private readonly messenger: BusinessMessenger,
    private readonly notifier: AdminNotifier,
    private readonly availability: AiAvailabilityService,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async runBatch(workerId: string): Promise<number> {
    const now = new Date();
    const candidateQuery = {
      processAfter: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    };
    const [fresh, backlog] = await Promise.all([
      this.prisma.conversationJob.findMany({
        where: {
          ...candidateQuery,
          status: { in: [MessageProcessingStatus.PENDING, MessageProcessingStatus.READY] },
        },
        orderBy: [{ processAfter: 'asc' }, { createdAt: 'asc' }],
        take: this.config.worker.batchSize * 4,
        select: { conversationId: true },
      }),
      this.prisma.conversationJob.findMany({
        where: {
          ...candidateQuery,
          status: {
            in: [
              MessageProcessingStatus.WAITING_FOR_AI_AVAILABILITY,
              MessageProcessingStatus.PROCESSING,
            ],
          },
        },
        orderBy: [{ processAfter: 'asc' }, { createdAt: 'asc' }],
        take: this.config.worker.batchSize * 4,
        select: { conversationId: true },
      }),
    ]);
    const interleaved = [] as typeof fresh;
    for (let index = 0; index < Math.max(fresh.length, backlog.length); index += 1) {
      const current = fresh[index];
      const waiting = backlog[index];
      if (current) interleaved.push(current);
      if (waiting) interleaved.push(waiting);
    }
    const uniqueCandidateIds = [...new Set(interleaved.map((item) => item.conversationId))];
    const candidateConversations = await this.prisma.conversation.findMany({
      where: { id: { in: uniqueCandidateIds } },
      select: { id: true, businessAccountId: true },
    });
    const byBusiness = new Map<string, typeof candidateConversations>();
    const businessByConversation = new Map(
      candidateConversations.map((conversation) => [
        conversation.id,
        conversation.businessAccountId,
      ]),
    );
    for (const candidate of interleaved) {
      const businessAccountId = businessByConversation.get(candidate.conversationId);
      if (!businessAccountId) continue;
      const queue = byBusiness.get(businessAccountId) ?? [];
      if (!queue.some((item) => item.id === candidate.conversationId)) {
        queue.push({ id: candidate.conversationId, businessAccountId });
      }
      byBusiness.set(businessAccountId, queue);
    }
    const conversationIds: string[] = [];
    while (conversationIds.length < this.config.worker.batchSize) {
      let added = false;
      for (const queue of byBusiness.values()) {
        const candidate = queue.shift();
        if (!candidate) continue;
        conversationIds.push(candidate.id);
        added = true;
        if (conversationIds.length === this.config.worker.batchSize) break;
      }
      if (!added) break;
    }
    let count = 0;
    for (const conversationId of conversationIds) {
      const businessAccountId = businessByConversation.get(conversationId);
      if (!businessAccountId) continue;
      const businessClaim = await this.prisma.businessAccount.updateMany({
        where: {
          id: businessAccountId,
          OR: [
            { aiProcessingLeaseExpiresAt: null },
            { aiProcessingLeaseExpiresAt: { lt: now } },
            { aiProcessingLeaseOwner: workerId },
          ],
        },
        data: {
          aiProcessingLeaseOwner: workerId,
          aiProcessingLeaseExpiresAt: millisecondsFrom(now, this.config.worker.leaseMs),
        },
      });
      if (businessClaim.count !== 1) continue;
      if (
        !(await tryAcquireConversationLease(
          this.prisma,
          conversationId,
          workerId,
          this.config.worker.leaseMs,
        ))
      ) {
        await this.#releaseBusiness(businessAccountId, workerId);
        continue;
      }
      count += 1;
      try {
        await this.#processConversation(conversationId, workerId);
      } catch (error) {
        await this.#handleFailure(conversationId, workerId, error);
      } finally {
        await this.prisma.conversation.updateMany({
          where: { id: conversationId, processingLeaseOwner: workerId },
          data: { processingLeaseOwner: null, processingLeaseExpiresAt: null },
        });
        await this.#releaseBusiness(businessAccountId, workerId);
      }
    }
    return count;
  }

  async #releaseBusiness(businessAccountId: string, workerId: string): Promise<void> {
    await this.prisma.businessAccount.updateMany({
      where: { id: businessAccountId, aiProcessingLeaseOwner: workerId },
      data: { aiProcessingLeaseOwner: null, aiProcessingLeaseExpiresAt: null },
    });
  }

  async #processConversation(conversationId: string, workerId: string): Promise<void> {
    const now = new Date();
    const batchId = newId();
    const jobs = await this.prisma.conversationJob.findMany({
      where: {
        conversationId,
        status: { in: [...runnable] },
        processAfter: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: workerId }],
        message: { senderType: SenderType.CUSTOMER, deletedAt: null, text: { not: null } },
      },
      include: { message: true },
      orderBy: { message: { sentAt: 'asc' } },
    });
    const firstJob = jobs[0];
    if (!firstJob) return;
    const ids = jobs.map((job) => job.id);
    const claimed = await this.prisma.conversationJob.updateMany({
      where: {
        id: { in: ids },
        status: { in: [...runnable] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: workerId }],
      },
      data: {
        status: MessageProcessingStatus.PROCESSING,
        leaseOwner: workerId,
        leaseExpiresAt: millisecondsFrom(now, this.config.worker.leaseMs),
        processingBatchId: batchId,
        waitingReason: null,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== jobs.length) {
      await this.#returnToReady(ids, 'BATCH_CLAIM_CONFLICT');
      return;
    }

    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        businessAccount: { include: { aiSettings: true } },
        customer: true,
        handoffs: { where: { activeKey: { not: null } }, take: 1 },
        messages: {
          where: { text: { not: null }, deletedAt: null },
          orderBy: { sentAt: 'desc' },
          take: this.config.rag.contextMessages + jobs.length,
        },
      },
    });
    const firstAt = firstJob.message.sentAt;
    const settings = await this.availability.businessSettings(conversation.businessAccountId);
    const maxAgeMs = Math.max(1, settings.backlogMaxAgeHours) * 3_600_000;
    if (
      firstAt.getTime() + maxAgeMs <= now.getTime() ||
      !conversation.telegramReplyWindowExpiresAt ||
      conversation.telegramReplyWindowExpiresAt <= now
    ) {
      await this.#finishBatch(jobs, MessageProcessingStatus.EXPIRED, batchId, 'BACKLOG_EXPIRED');
      await this.#audit(conversation.businessAccountId, conversationId, 'AI_MESSAGE_EXPIRED', {
        messageCount: jobs.length,
        reason: 'BACKLOG_OR_TELEGRAM_WINDOW_EXPIRED',
      });
      return;
    }
    if (conversation.mode !== ConversationMode.AI || conversation.handoffs.length > 0) {
      await this.#finishBatch(
        jobs,
        MessageProcessingStatus.CANCELLED_BY_HUMAN,
        batchId,
        'HUMAN_MODE_OR_HANDOFF',
      );
      await this.#audit(
        conversation.businessAccountId,
        conversationId,
        'AI_MESSAGE_CANCELLED_BY_HUMAN',
        { messageCount: jobs.length, reason: 'HUMAN_MODE_OR_HANDOFF' },
      );
      return;
    }
    if (this.#hasHumanReply(conversation.messages, firstAt)) {
      await this.#finishBatch(
        jobs,
        MessageProcessingStatus.CANCELLED_BY_HUMAN,
        batchId,
        'HUMAN_REPLIED',
      );
      await this.#audit(
        conversation.businessAccountId,
        conversationId,
        'AI_MESSAGE_CANCELLED_BY_HUMAN',
        { messageCount: jobs.length, reason: 'HUMAN_REPLIED' },
      );
      return;
    }

    const availability = await this.availability.check({
      businessAccountId: conversation.businessAccountId,
      conversationId,
      includeTelegramChecks: true,
    });
    if (!availability.available) {
      await this.#handleUnavailable(jobs, conversation.businessAccountId, availability.reason);
      return;
    }
    await this.#audit(conversation.businessAccountId, conversationId, 'AI_BACKLOG_RELEASED', {
      messageCount: jobs.length,
    });

    const abuseReason = await this.#reserveAutomatedResponse(
      conversation.customer,
      conversation.businessAccount,
      jobs,
      now,
    );
    if (abuseReason) {
      await this.#finishBatch(jobs, MessageProcessingStatus.SUPERSEDED, batchId, abuseReason);
      await this.#audit(conversation.businessAccountId, conversationId, 'AI_ABUSE_RATE_LIMITED', {
        messageCount: jobs.length,
        reason: abuseReason,
      });
      this.logger.warn(
        { businessAccountId: conversation.businessAccountId, conversationId, abuseReason },
        'automated response suppressed by customer abuse protection',
      );
      return;
    }

    const currentMessageBatch = jobs.map((job) => ({
      id: job.message.id,
      text: job.message.text ?? '',
      sentAt: job.message.sentAt,
    }));
    const customerText = currentMessageBatch.map((item) => item.text).join('\n');
    const route = preModelRoute(customerText, {
      safeGreetingEnabled: this.config.routing.safeGreetingEnabled,
    });
    if (route.kind === 'HANDOFF') {
      await this.#activateHandoff(
        conversationId,
        'EXPLICIT_HUMAN_REQUEST',
        route.kind,
        firstJob.messageId,
      );
      await this.#finishBatch(jobs, MessageProcessingStatus.PROCESSED, batchId, null);
      return;
    }

    let answer: string | null = route.kind === 'SAFE_GREETING' ? route.answer : null;
    if (!answer) {
      const retrieved = await this.retrieval.search(conversation.businessAccountId, customerText);
      const batchMessageIds = new Set(jobs.map((job) => job.messageId));
      const context = [...conversation.messages]
        .reverse()
        .filter(
          (message) => !batchMessageIds.has(message.id) && message.sentAt < firstAt && message.text,
        )
        .map((message) => ({
          senderType: message.senderType,
          text: (message.text ?? '').slice(0, 2_000),
          sentAt: message.sentAt,
        }));
      const decision = await this.answerer.decide({
        customerText,
        currentMessageBatch,
        retrieved,
        context,
      });
      await this.#recordDecision(firstJob, decision, retrieved);
      if (!decision.answerable || !decision.answer) {
        await this.#activateHandoff(
          conversationId,
          'AI_NOT_ANSWERABLE',
          decision.reason,
          firstJob.messageId,
        );
        await this.#finishBatch(jobs, MessageProcessingStatus.PROCESSED, batchId, null);
        return;
      }
      answer = decision.answer;
    }

    const finalState = await this.#finalEligibility(
      conversationId,
      conversation.businessAccountId,
      firstAt,
    );
    if (finalState !== 'AVAILABLE') {
      if (finalState === 'HUMAN_REPLIED' || finalState === 'HUMAN_MODE') {
        await this.#finishBatch(
          jobs,
          MessageProcessingStatus.CANCELLED_BY_HUMAN,
          batchId,
          finalState,
        );
        await this.#audit(
          conversation.businessAccountId,
          conversationId,
          'AI_MESSAGE_CANCELLED_BY_HUMAN',
          { messageCount: jobs.length, reason: finalState },
        );
      } else {
        await this.#handleUnavailable(jobs, conversation.businessAccountId, finalState);
      }
      return;
    }
    await this.messenger.sendAiAnswer(conversationId, answer, firstJob.messageId);
    await this.#finishBatch(jobs, MessageProcessingStatus.PROCESSED, batchId, null);
    await this.#audit(
      conversation.businessAccountId,
      conversationId,
      'AI_MESSAGE_BATCH_PROCESSED',
      { messageCount: jobs.length, batchId },
    );
  }

  async #reserveAutomatedResponse(
    customer: {
      id: string;
      aiHourlyWindowStartedAt: Date | null;
      aiHourlyRequestCount: number;
      aiDailyWindowStartedAt: Date | null;
      aiDailyRequestCount: number;
      aiBlockedUntil: Date | null;
    },
    business: {
      id: string;
      aiHourlyWindowStartedAt: Date | null;
      aiHourlyRequestCount: number;
      aiDailyWindowStartedAt: Date | null;
      aiDailyRequestCount: number;
      aiBlockedUntil: Date | null;
    },
    jobs: BatchJob[],
    now: Date,
  ): Promise<string | null> {
    const limits = this.config.abuseProtection;
    const totalCharacters = jobs.reduce((sum, job) => sum + (job.message.text?.length ?? 0), 0);
    if (jobs.length > limits.maxBatchMessages || totalCharacters > limits.maxBatchChars) {
      return 'AI_ABUSE_BATCH_TOO_LARGE';
    }
    if (customer.aiBlockedUntil && customer.aiBlockedUntil > now) {
      return 'AI_ABUSE_COOLDOWN_ACTIVE';
    }
    if (business.aiBlockedUntil && business.aiBlockedUntil > now) {
      return 'AI_BUSINESS_BUDGET_COOLDOWN_ACTIVE';
    }
    const hourlyActive = Boolean(
      customer.aiHourlyWindowStartedAt &&
      customer.aiHourlyWindowStartedAt.getTime() > now.getTime() - 3_600_000,
    );
    const dailyActive = Boolean(
      customer.aiDailyWindowStartedAt &&
      customer.aiDailyWindowStartedAt.getTime() > now.getTime() - 86_400_000,
    );
    const hourlyCount = hourlyActive ? customer.aiHourlyRequestCount : 0;
    const dailyCount = dailyActive ? customer.aiDailyRequestCount : 0;
    const businessHourlyActive = Boolean(
      business.aiHourlyWindowStartedAt &&
      business.aiHourlyWindowStartedAt.getTime() > now.getTime() - 3_600_000,
    );
    const businessDailyActive = Boolean(
      business.aiDailyWindowStartedAt &&
      business.aiDailyWindowStartedAt.getTime() > now.getTime() - 86_400_000,
    );
    const businessHourlyCount = businessHourlyActive ? business.aiHourlyRequestCount : 0;
    const businessDailyCount = businessDailyActive ? business.aiDailyRequestCount : 0;
    if (hourlyCount >= limits.maxRequestsPerHour || dailyCount >= limits.maxRequestsPerDay) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          aiBlockedUntil: millisecondsFrom(now, limits.cooldownMinutes * 60_000),
        },
      });
      return hourlyCount >= limits.maxRequestsPerHour
        ? 'AI_ABUSE_HOURLY_LIMIT'
        : 'AI_ABUSE_DAILY_LIMIT';
    }
    if (
      businessHourlyCount >= limits.businessMaxRequestsPerHour ||
      businessDailyCount >= limits.businessMaxRequestsPerDay
    ) {
      await this.prisma.businessAccount.update({
        where: { id: business.id },
        data: {
          aiBlockedUntil: millisecondsFrom(now, limits.businessCooldownMinutes * 60_000),
        },
      });
      return businessHourlyCount >= limits.businessMaxRequestsPerHour
        ? 'AI_BUSINESS_HOURLY_BUDGET_LIMIT'
        : 'AI_BUSINESS_DAILY_BUDGET_LIMIT';
    }
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          aiHourlyWindowStartedAt: hourlyActive ? customer.aiHourlyWindowStartedAt : now,
          aiHourlyRequestCount: hourlyCount + 1,
          aiDailyWindowStartedAt: dailyActive ? customer.aiDailyWindowStartedAt : now,
          aiDailyRequestCount: dailyCount + 1,
          aiBlockedUntil: null,
        },
      }),
      this.prisma.businessAccount.update({
        where: { id: business.id },
        data: {
          aiHourlyWindowStartedAt: businessHourlyActive ? business.aiHourlyWindowStartedAt : now,
          aiHourlyRequestCount: businessHourlyCount + 1,
          aiDailyWindowStartedAt: businessDailyActive ? business.aiDailyWindowStartedAt : now,
          aiDailyRequestCount: businessDailyCount + 1,
          aiBlockedUntil: null,
        },
      }),
    ]);
    return null;
  }

  async #finalEligibility(
    conversationId: string,
    businessAccountId: string,
    firstAt: Date,
  ): Promise<AiAvailabilityReason | 'HUMAN_REPLIED'> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        messages: { where: { senderType: SenderType.HUMAN, sentAt: { gt: firstAt } }, take: 1 },
      },
    });
    if (conversation.mode !== ConversationMode.AI) return 'HUMAN_MODE';
    if (conversation.messages.length) return 'HUMAN_REPLIED';
    const result = await this.availability.check({
      businessAccountId,
      conversationId,
      includeTelegramChecks: true,
    });
    return result.reason;
  }

  #hasHumanReply(messages: Message[], firstAt: Date): boolean {
    return messages.some(
      (message) => message.senderType === SenderType.HUMAN && message.sentAt > firstAt,
    );
  }

  async #handleUnavailable(
    jobs: BatchJob[],
    businessAccountId: string,
    reason: AiAvailabilityReason,
  ): Promise<void> {
    const firstJob = jobs[0];
    if (!firstJob) return;
    const settings = await this.availability.businessSettings(businessAccountId);
    const policy: QueuePolicy =
      reason === 'MASTER_DISABLED' ? settings.manualShutdownPolicy : settings.outsideHoursPolicy;
    if (reason === 'TELEGRAM_REPLY_WINDOW_EXPIRED') {
      await this.#finishBatch(
        jobs,
        MessageProcessingStatus.EXPIRED,
        firstJob.processingBatchId ?? newId(),
        reason,
      );
      await this.#audit(businessAccountId, firstJob.conversationId, 'AI_MESSAGE_EXPIRED', {
        messageCount: jobs.length,
        reason,
      });
      return;
    }
    if (policy === 'HANDOFF') {
      await this.#activateHandoff(
        firstJob.conversationId,
        'AI_UNAVAILABLE',
        reason,
        firstJob.messageId,
      );
      await this.#finishBatch(
        jobs,
        MessageProcessingStatus.CANCELLED_BY_HUMAN,
        firstJob.processingBatchId ?? newId(),
        reason,
      );
      return;
    }
    if (policy === 'SILENT') {
      await this.#finishBatch(
        jobs,
        MessageProcessingStatus.SUPERSEDED,
        firstJob.processingBatchId ?? newId(),
        reason,
      );
      await this.#audit(businessAccountId, firstJob.conversationId, 'AI_MESSAGE_SUPERSEDED', {
        messageCount: jobs.length,
        reason,
      });
      return;
    }
    // Reconsider waiting work every poll. This is intentionally independent of the
    // previously calculated opening time so schedule/timezone edits and master-switch
    // changes are discovered by every worker after restarts as well.
    const processAfter = millisecondsFrom(new Date(), this.config.worker.pollIntervalMs);
    const ids = jobs.map((job) => job.id);
    await this.prisma.$transaction([
      this.prisma.conversationJob.updateMany({
        where: { id: { in: ids } },
        data: {
          status: MessageProcessingStatus.WAITING_FOR_AI_AVAILABILITY,
          processAfter,
          waitingReason: reason,
          lastErrorCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          processingBatchId: null,
        },
      }),
      this.prisma.message.updateMany({
        where: { id: { in: jobs.map((job) => job.messageId) } },
        data: {
          processingStatus: MessageProcessingStatus.WAITING_FOR_AI_AVAILABILITY,
          processingErrorCode: null,
          processingBatchId: null,
        },
      }),
    ]);
    await this.#audit(businessAccountId, firstJob.conversationId, 'AI_MESSAGE_WAITING', {
      messageCount: jobs.length,
      reason,
    });
  }

  async #finishBatch(
    jobs: BatchJob[],
    status: MessageProcessingStatus,
    batchId: string,
    reason: string | null,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.conversationJob.updateMany({
        where: { id: { in: jobs.map((job) => job.id) } },
        data: {
          status,
          waitingReason: null,
          lastErrorCode: reason,
          leaseOwner: null,
          leaseExpiresAt: null,
          processingBatchId: batchId,
        },
      }),
      this.prisma.message.updateMany({
        where: { id: { in: jobs.map((job) => job.messageId) } },
        data: { processingStatus: status, processingErrorCode: reason, processingBatchId: batchId },
      }),
    ]);
  }

  async #returnToReady(ids: string[], reason: string): Promise<void> {
    await this.prisma.conversationJob.updateMany({
      where: { id: { in: ids } },
      data: {
        status: MessageProcessingStatus.READY,
        processAfter: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: reason,
      },
    });
  }

  async #recordDecision(
    job: BatchJob,
    decision: Awaited<ReturnType<GroundedAnswerer['decide']>>,
    retrieved: Awaited<ReturnType<RetrievalService['search']>>,
  ): Promise<void> {
    await this.prisma.aiDecisionLog.upsert({
      where: { messageId: job.messageId },
      create: {
        id: newId(),
        conversationId: job.conversationId,
        messageId: job.messageId,
        answerable: decision.answerable,
        confidence: decision.confidence,
        reason: decision.reason,
        answer: decision.answer,
        supportingChunkIds: decision.supportingChunkIds,
        retrievalResults: retrieved.map((item) => ({ chunkId: item.chunkId, score: item.score })),
        model: decision.model,
        promptVersion: PROMPT_VERSION,
        latencyMs: decision.latencyMs,
        ...(decision.inputTokens === undefined ? {} : { inputTokens: decision.inputTokens }),
        ...(decision.outputTokens === undefined ? {} : { outputTokens: decision.outputTokens }),
        ...(decision.totalTokens === undefined ? {} : { totalTokens: decision.totalTokens }),
      },
      update: {
        answerable: decision.answerable,
        confidence: decision.confidence,
        reason: decision.reason,
        answer: decision.answer,
        supportingChunkIds: decision.supportingChunkIds,
        retrievalResults: retrieved.map((item) => ({ chunkId: item.chunkId, score: item.score })),
        model: decision.model,
        latencyMs: decision.latencyMs,
        errorCode: null,
        ...(decision.inputTokens === undefined ? {} : { inputTokens: decision.inputTokens }),
        ...(decision.outputTokens === undefined ? {} : { outputTokens: decision.outputTokens }),
        ...(decision.totalTokens === undefined ? {} : { totalTokens: decision.totalTokens }),
      },
    });
  }

  async #activateHandoff(
    conversationId: string,
    reasonCode: string,
    detail: string,
    sourceMessageId: string,
  ): Promise<void> {
    const activated = await this.handoffs.activate(conversationId, reasonCode, detail);
    if (activated.created && this.config.handoff.customerMessageEnabled) {
      await this.messenger.sendHandoffAcknowledgement(
        conversationId,
        this.config.handoff.customerMessage,
        sourceMessageId,
      );
    }
  }

  async #audit(
    businessAccountId: string,
    conversationId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: newId(),
        businessAccountId,
        actorType: 'SYSTEM',
        action,
        entityType: 'Conversation',
        entityId: conversationId,
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
  }

  async #handleFailure(conversationId: string, workerId: string, error: unknown): Promise<void> {
    const code = errorCode(error);
    const jobs = await this.prisma.conversationJob.findMany({
      where: { conversationId, leaseOwner: workerId, status: MessageProcessingStatus.PROCESSING },
      include: { message: true },
    });
    const firstJob = jobs[0];
    if (!firstJob) return;
    const attempts = Math.max(...jobs.map((job) => job.attempts));
    const maxAttempts = Math.min(...jobs.map((job) => job.maxAttempts));
    this.logger.error({ err: error, conversationId, attempts }, 'conversation batch failed');
    if (!shouldHandoffExternalFailure(attempts, maxAttempts)) {
      await this.prisma.conversationJob.updateMany({
        where: { id: { in: jobs.map((job) => job.id) } },
        data: {
          status: MessageProcessingStatus.READY,
          processAfter: millisecondsFrom(new Date(), 1_000 * 2 ** Math.max(0, attempts - 1)),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: code,
          lastErrorDetail: safeErrorDetail(error),
        },
      });
      return;
    }
    await this.#finishBatch(
      jobs,
      MessageProcessingStatus.FAILED,
      firstJob.processingBatchId ?? newId(),
      code,
    );
    await this.#activateHandoff(
      conversationId,
      'EXTERNAL_SERVICE_FAILURE',
      code,
      firstJob.messageId,
    ).catch(() => undefined);
    void this.notifier;
  }
}
