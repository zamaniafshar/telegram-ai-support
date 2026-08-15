import { describe, expect, it, vi } from 'vitest';
import { ConversationMode, MessageProcessingStatus, SenderType } from '@prisma/client';
import { ConversationProcessor } from '../src/conversations/processor.js';
import { silentLogger, testConfig } from './helpers.js';

function harness(reasons: string[], texts = ['سؤال درباره محصول']) {
  const now = new Date();
  const messages = texts.map((text, index) => ({
    id: `message-${index + 1}`,
    conversationId: 'conversation-1',
    text,
    senderType: SenderType.CUSTOMER,
    sentAt: new Date(now.getTime() + index * 1_000),
    deletedAt: null,
  }));
  const jobs = messages.map((message, index) => ({
    id: `job-${index + 1}`,
    conversationId: 'conversation-1',
    messageId: message.id,
    message,
    status: MessageProcessingStatus.PENDING,
    processAfter: now,
    attempts: 0,
    maxAttempts: 5,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    waitingReason: null,
    processingBatchId: null,
    createdAt: now,
    updatedAt: now,
  }));
  const conversation = {
    id: 'conversation-1',
    businessAccountId: 'business-1',
    mode: ConversationMode.AI,
    telegramReplyWindowExpiresAt: new Date(now.getTime() + 3_600_000),
    businessAccount: {
      id: 'business-1',
      aiSettings: null,
      aiHourlyWindowStartedAt: null,
      aiHourlyRequestCount: 0,
      aiDailyWindowStartedAt: null,
      aiDailyRequestCount: 0,
      aiBlockedUntil: null,
    },
    customer: {
      id: 'customer-1',
      aiHourlyWindowStartedAt: null,
      aiHourlyRequestCount: 0,
      aiDailyWindowStartedAt: null,
      aiDailyRequestCount: 0,
      aiBlockedUntil: null,
    },
    handoffs: [],
    messages,
  };
  const prisma = {
    customer: { update: vi.fn().mockResolvedValue({}) },
    businessAccount: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    conversationJob: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([{ conversationId: 'conversation-1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(jobs),
      updateMany: vi.fn().mockResolvedValue({ count: jobs.length }),
    },
    conversation: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'conversation-1', businessAccountId: 'business-1' }]),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValueOnce(conversation)
        .mockResolvedValue({ ...conversation, messages: [] }),
    },
    message: { updateMany: vi.fn().mockResolvedValue({ count: jobs.length }) },
    aiDecisionLog: { upsert: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const retrieval = { search: vi.fn().mockResolvedValue([]) };
  const answerer = {
    decide: vi.fn().mockResolvedValue({
      answerable: true,
      confidence: 0.95,
      reason: 'grounded',
      answer: 'پاسخ یکپارچه',
      supportingChunkIds: [],
      model: 'test',
      latencyMs: 1,
    }),
  };
  const messenger = {
    sendAiAnswer: vi.fn(),
    sendHandoffAcknowledgement: vi.fn(),
    whileTyping: vi.fn(async (_conversationId: string, operation: () => Promise<unknown>) =>
      operation(),
    ),
  };
  const availability = {
    businessSettings: vi.fn().mockResolvedValue({
      enabled: true,
      timezone: 'Asia/Tehran',
      weeklySchedule: [],
      outsideHoursPolicy: 'QUEUE',
      manualShutdownPolicy: 'QUEUE',
      backlogMaxAgeHours: 24,
    }),
    check: vi.fn().mockImplementation(async () => {
      const reason = reasons.shift() ?? 'AVAILABLE';
      return { available: reason === 'AVAILABLE', reason, nextTransitionAt: null };
    }),
  };
  const processor = new ConversationProcessor(
    prisma as never,
    retrieval as never,
    answerer as never,
    { activate: vi.fn() } as never,
    messenger as never,
    {} as never,
    availability as never,
    testConfig({ SAFE_GREETING_ENABLED: 'false', WORKER_POLL_INTERVAL_MS: '100' }),
    silentLogger,
  );
  return { processor, prisma, retrieval, answerer, messenger, availability, jobs };
}

describe('conversation backlog availability gates', () => {
  it('durably waits when the master switch is disabled', async () => {
    const value = harness(['MASTER_DISABLED']);
    await value.processor.runBatch('worker-1');
    expect(value.retrieval.search).not.toHaveBeenCalled();
    expect(value.answerer.decide).not.toHaveBeenCalled();
    expect(value.messenger.sendAiAnswer).not.toHaveBeenCalled();
    expect(value.prisma.conversationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MessageProcessingStatus.WAITING_FOR_AI_AVAILABILITY,
          waitingReason: 'MASTER_DISABLED',
        }),
      }),
    );
  });

  it('returns the batch to waiting when AI is disabled during generation', async () => {
    const value = harness(['AVAILABLE', 'MASTER_DISABLED']);
    await value.processor.runBatch('worker-1');
    expect(value.answerer.decide).toHaveBeenCalledTimes(1);
    expect(value.messenger.sendAiAnswer).not.toHaveBeenCalled();
    expect(value.prisma.conversationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MessageProcessingStatus.WAITING_FOR_AI_AVAILABILITY,
          waitingReason: 'MASTER_DISABLED',
        }),
      }),
    );
  });

  it('combines consecutive messages into one model request and one response', async () => {
    const value = harness(['AVAILABLE', 'AVAILABLE'], ['سلام', 'قیمت محصول چقدر است؟']);
    await value.processor.runBatch('worker-1');
    expect(value.answerer.decide).toHaveBeenCalledTimes(1);
    expect(value.answerer.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMessageBatch: [
          expect.objectContaining({ id: 'message-1', text: 'سلام' }),
          expect.objectContaining({ id: 'message-2', text: 'قیمت محصول چقدر است؟' }),
        ],
      }),
    );
    expect(value.messenger.sendAiAnswer).toHaveBeenCalledTimes(1);
    expect(value.prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-1' },
        data: expect.objectContaining({ aiHourlyRequestCount: 1, aiDailyRequestCount: 1 }),
      }),
    );
    expect(value.prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['message-1', 'message-2'] } },
        data: expect.objectContaining({ processingStatus: MessageProcessingStatus.PROCESSED }),
      }),
    );
  });

  it('suppresses an oversized message burst before retrieval or model work', async () => {
    const value = harness(['AVAILABLE'], ['یک', 'دو', 'سه']);
    const limited = new ConversationProcessor(
      value.prisma as never,
      value.retrieval as never,
      value.answerer as never,
      { activate: vi.fn() } as never,
      value.messenger as never,
      {} as never,
      value.availability as never,
      testConfig({ SAFE_GREETING_ENABLED: 'false', AI_MAX_BATCH_MESSAGES: '2' }),
      silentLogger,
    );

    await limited.runBatch('worker-1');

    expect(value.retrieval.search).not.toHaveBeenCalled();
    expect(value.answerer.decide).not.toHaveBeenCalled();
    expect(value.messenger.sendAiAnswer).not.toHaveBeenCalled();
    expect(value.prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: MessageProcessingStatus.SUPERSEDED,
          processingErrorCode: 'AI_ABUSE_BATCH_TOO_LARGE',
        }),
      }),
    );
  });

  it('suppresses customers in a durable cooldown before provider work', async () => {
    const value = harness(['AVAILABLE']);
    value.prisma.conversation.findUniqueOrThrow.mockReset();
    value.prisma.conversation.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'conversation-1',
        businessAccountId: 'business-1',
        mode: ConversationMode.AI,
        telegramReplyWindowExpiresAt: new Date(Date.now() + 3_600_000),
        businessAccount: {
          id: 'business-1',
          aiSettings: null,
          aiHourlyWindowStartedAt: null,
          aiHourlyRequestCount: 0,
          aiDailyWindowStartedAt: null,
          aiDailyRequestCount: 0,
          aiBlockedUntil: null,
        },
        customer: {
          id: 'customer-1',
          aiHourlyWindowStartedAt: new Date(),
          aiHourlyRequestCount: 10,
          aiDailyWindowStartedAt: new Date(),
          aiDailyRequestCount: 10,
          aiBlockedUntil: new Date(Date.now() + 60_000),
        },
        handoffs: [],
        messages: value.jobs.map((job) => job.message),
      })
      .mockResolvedValue({ mode: ConversationMode.AI, messages: [] });

    await value.processor.runBatch('worker-1');

    expect(value.answerer.decide).not.toHaveBeenCalled();
    expect(value.messenger.sendAiAnswer).not.toHaveBeenCalled();
    expect(value.prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingErrorCode: 'AI_ABUSE_COOLDOWN_ACTIVE' }),
      }),
    );
  });

  it('enforces a durable business-wide budget against multi-account abuse', async () => {
    const value = harness(['AVAILABLE']);
    value.prisma.conversation.findUniqueOrThrow.mockReset();
    value.prisma.conversation.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'conversation-1',
        businessAccountId: 'business-1',
        mode: ConversationMode.AI,
        telegramReplyWindowExpiresAt: new Date(Date.now() + 3_600_000),
        businessAccount: {
          id: 'business-1',
          aiSettings: null,
          aiHourlyWindowStartedAt: new Date(),
          aiHourlyRequestCount: 100,
          aiDailyWindowStartedAt: new Date(),
          aiDailyRequestCount: 100,
          aiBlockedUntil: null,
        },
        customer: {
          id: 'customer-1',
          aiHourlyWindowStartedAt: null,
          aiHourlyRequestCount: 0,
          aiDailyWindowStartedAt: null,
          aiDailyRequestCount: 0,
          aiBlockedUntil: null,
        },
        handoffs: [],
        messages: value.jobs.map((job) => job.message),
      })
      .mockResolvedValue({ mode: ConversationMode.AI, messages: [] });

    await value.processor.runBatch('worker-1');

    expect(value.answerer.decide).not.toHaveBeenCalled();
    expect(value.messenger.sendAiAnswer).not.toHaveBeenCalled();
    expect(value.prisma.businessAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'business-1' },
        data: expect.objectContaining({ aiBlockedUntil: expect.any(Date) }),
      }),
    );
    expect(value.prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingErrorCode: 'AI_BUSINESS_HOURLY_BUDGET_LIMIT',
        }),
      }),
    );
  });
});
