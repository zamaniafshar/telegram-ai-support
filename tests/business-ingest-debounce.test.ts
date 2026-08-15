import { MessageProcessingStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessUpdateIngestor } from '../src/telegram-business/ingest.js';
import { silentLogger, testConfig } from './helpers.js';

describe('conversation message debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restarts the pending conversation deadline after every customer message', async () => {
    vi.useFakeTimers();
    const updateMany = vi.fn(
      async (input: {
        where: { conversationId: string; status: { in: MessageProcessingStatus[] } };
        data: { processAfter: Date };
      }) => {
        void input;
        return { count: 1 };
      },
    );
    const transactionClient = {
      processedTelegramUpdate: { create: vi.fn().mockResolvedValue({}) },
      customer: { upsert: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
      conversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-1' }) },
      message: {
        upsert: vi
          .fn()
          .mockResolvedValueOnce({ id: 'message-a' })
          .mockResolvedValueOnce({ id: 'message-b' })
          .mockResolvedValueOnce({ id: 'message-c' }),
      },
      conversationJob: {
        upsert: vi.fn().mockResolvedValue({}),
        updateMany,
      },
    };
    const connection = {
      id: 'connection-1',
      businessAccountId: 'business-1',
      businessAccount: { telegramAccountUserId: 999n },
    };
    const prisma = {
      businessConnection: {
        findUnique: vi.fn().mockResolvedValue(connection),
        findUniqueOrThrow: vi.fn().mockResolvedValue(connection),
      },
      $transaction: vi.fn(async (operation: (tx: typeof transactionClient) => unknown) =>
        operation(transactionClient),
      ),
    };
    const ingestor = new BusinessUpdateIngestor(
      prisma as never,
      {} as never,
      testConfig({ MESSAGE_DEBOUNCE_MS: '300000' }),
      silentLogger,
    );

    const ingestAt = async (time: string, updateId: number, messageId: number) => {
      vi.setSystemTime(new Date(time));
      await ingestor.ingest(
        {
          update_id: updateId,
          business_message: {
            message_id: messageId,
            date: Math.floor(new Date(time).getTime() / 1_000),
            chat: { id: 123, type: 'private' },
            from: { id: 123, is_bot: false, first_name: 'Customer' },
            business_connection_id: 'connection-1',
            text: `message ${messageId}`,
          },
        },
        `correlation-${updateId}`,
      );
    };

    await ingestAt('2026-08-15T10:00:00.000Z', 1, 101);
    await ingestAt('2026-08-15T10:02:00.000Z', 2, 102);
    await ingestAt('2026-08-15T10:04:00.000Z', 3, 103);

    expect(updateMany).toHaveBeenCalledTimes(3);
    expect(updateMany.mock.calls.map(([call]) => call.data.processAfter.toISOString())).toEqual([
      '2026-08-15T10:05:00.000Z',
      '2026-08-15T10:07:00.000Z',
      '2026-08-15T10:09:00.000Z',
    ]);
    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        conversationId: 'conversation-1',
        status: {
          in: [
            MessageProcessingStatus.PENDING,
            MessageProcessingStatus.READY,
            MessageProcessingStatus.WAITING_FOR_AI_AVAILABILITY,
          ],
        },
      },
      data: { processAfter: new Date('2026-08-15T10:09:00.000Z') },
    });
  });
});
