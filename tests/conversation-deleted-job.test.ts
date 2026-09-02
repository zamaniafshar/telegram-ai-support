import { describe, expect, it, vi } from 'vitest';
import { ConversationMode, MessageProcessingStatus, SenderType } from '@prisma/client';
import { ConversationProcessor } from '../src/conversations/processor.js';
import { BusinessUpdateIngestor } from '../src/telegram-business/ingest.js';
import { silentLogger, testConfig } from './helpers.js';
import type { TelegramApi } from '../src/telegram-business/client.js';

describe('Deleted and Empty Message Handling (Issue 2)', () => {
  it('ConversationProcessor cleans up orphan jobs for deleted/empty messages and returns 0 count', async () => {
    const now = new Date();
    const mockPrisma = {
      conversationJob: {
        findMany: vi
          .fn()
          // First call for fresh candidates in runBatch
          .mockResolvedValueOnce([{ conversationId: 'conv-1' }])
          // Second call for backlog candidates in runBatch
          .mockResolvedValueOnce([])
          // Third call inside #processConversation: findMany with message filtering returns 0 jobs!
          .mockResolvedValueOnce([])
          // Fourth call inside #processConversation: orphan search finds the orphan job!
          .mockResolvedValueOnce([{ id: 'orphan-job-1', messageId: 'msg-1' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      conversation: {
        findMany: vi.fn().mockResolvedValue([{ id: 'conv-1', businessAccountId: 'biz-1' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      businessAccount: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      message: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn().mockImplementation(async (promises: Promise<unknown>[]) => {
        return Promise.all(promises);
      }),
    };

    const processor = new ConversationProcessor(
      mockPrisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      testConfig(),
      silentLogger,
    );

    const count = await processor.runBatch('worker-1');

    // Count should be 0 because no actual conversational response was processed
    expect(count).toBe(0);

    // Verify the orphan job was marked CANCELLED_BY_HUMAN
    expect(mockPrisma.conversationJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['orphan-job-1'] } },
      data: expect.objectContaining({
        status: MessageProcessingStatus.CANCELLED_BY_HUMAN,
        lastErrorCode: 'EMPTY_OR_DELETED_MESSAGE',
      }),
    });
  });

  it('BusinessUpdateIngestor cancels pending ConversationJobs when messages are deleted', async () => {
    const mockPrisma = {
      businessAccount: {
        findFirst: vi.fn().mockResolvedValue({ id: 'biz-1' }),
      },
      conversation: {
        findFirst: vi.fn().mockResolvedValue({ id: 'conv-1', businessAccountId: 'biz-1' }),
      },
      message: {
        findMany: vi.fn().mockResolvedValue([{ id: 'msg-1', telegramMessageId: 100 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      conversationJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      processedTelegramUpdate: {
        create: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mockPrisma)),
    };

    const ingestor = new BusinessUpdateIngestor(
      mockPrisma as any,
      {} as TelegramApi,
      testConfig(),
      silentLogger,
    );

    await ingestor.ingest(
      {
        update_id: 12345,
        deleted_business_messages: {
          business_connection_id: 'conn-1',
          chat: { id: 98765, type: 'private' },
          message_ids: [100],
        },
      },
      'req-test-1',
    );

    // Verify conversationJob.updateMany was called to cancel pending jobs
    expect(mockPrisma.conversationJob.updateMany).toHaveBeenCalledWith({
      where: {
        messageId: { in: ['msg-1'] },
        status: {
          in: [
            MessageProcessingStatus.PENDING,
            MessageProcessingStatus.READY,
            MessageProcessingStatus.WAITING_FOR_AI_AVAILABILITY,
          ],
        },
      },
      data: {
        status: MessageProcessingStatus.CANCELLED_BY_HUMAN,
        lastErrorCode: 'MESSAGE_DELETED',
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  });
});
