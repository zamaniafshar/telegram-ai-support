import { describe, expect, it, vi } from 'vitest';
import { ConversationMode, MessageProcessingStatus } from '@prisma/client';
import { ConversationProcessor } from '../src/conversations/processor.js';
import { silentLogger, testConfig } from './helpers.js';

function harness(reasons: string[]) {
  const job = {
    id: 'job-1',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    status: MessageProcessingStatus.PROCESSING,
    processAfter: new Date(),
    attempts: 1,
    maxAttempts: 5,
    leaseOwner: 'worker-1',
    leaseExpiresAt: new Date(Date.now() + 60_000),
    lastErrorCode: null,
    lastErrorDetail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const message = {
    id: 'message-1',
    text: 'سؤال درباره محصول',
    conversation: {
      id: 'conversation-1',
      businessAccountId: 'business-1',
      mode: ConversationMode.AI,
      messages: [],
    },
  };
  const prisma = {
    conversationJob: {
      findMany: vi.fn().mockResolvedValue([{ id: job.id }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(job),
      update: vi.fn().mockResolvedValue(job),
    },
    conversation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    message: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(message),
      update: vi.fn().mockResolvedValue(message),
    },
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
      answer: 'پاسخ',
      supportingChunkIds: [],
      model: 'test',
      latencyMs: 1,
    }),
  };
  const messenger = { sendAiAnswer: vi.fn() };
  const availability = {
    check: vi.fn().mockImplementation(async () => {
      const reason = reasons.shift() ?? 'AVAILABLE';
      return { available: reason === 'AVAILABLE', reason };
    }),
  };
  const processor = new ConversationProcessor(
    prisma as never,
    retrieval as never,
    answerer as never,
    {} as never,
    messenger as never,
    {} as never,
    availability as never,
    testConfig({ SAFE_GREETING_ENABLED: 'false' }),
    silentLogger,
  );
  return { processor, prisma, retrieval, answerer, messenger, availability };
}

describe('conversation worker AI availability gates', () => {
  it('stores/completes a disabled-AI message without retrieval or model work', async () => {
    const value = harness(['MASTER_DISABLED']);
    await value.processor.runBatch('worker-1');
    expect(value.retrieval.search).not.toHaveBeenCalled();
    expect(value.answerer.decide).not.toHaveBeenCalled();
    expect(value.messenger.sendAiAnswer).not.toHaveBeenCalled();
    expect(value.prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingErrorCode: 'AI_MASTER_DISABLED' }),
      }),
    );
  });

  it('suppresses without retry when AI is disabled during generation', async () => {
    const value = harness(['AVAILABLE', 'MASTER_DISABLED']);
    await value.processor.runBatch('worker-1');
    expect(value.retrieval.search).toHaveBeenCalledTimes(1);
    expect(value.answerer.decide).toHaveBeenCalledTimes(1);
    expect(value.availability.check).toHaveBeenCalledTimes(2);
    expect(value.messenger.sendAiAnswer).not.toHaveBeenCalled();
    expect(value.prisma.conversationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MessageProcessingStatus.PROCESSED,
          lastErrorCode: 'AI_MASTER_DISABLED',
        }),
      }),
    );
  });
});
