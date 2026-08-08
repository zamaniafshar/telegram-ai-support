import { ConversationMode, SenderType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BusinessMessenger } from '../src/telegram-business/messenger.js';
import { silentLogger, testConfig } from './helpers.js';

function conversation(mode: ConversationMode) {
  return {
    id: 'conversation-1',
    mode,
    telegramChatId: 123n,
    telegramReplyWindowExpiresAt: new Date(Date.now() + 60_000),
    handoffs: mode === ConversationMode.HUMAN ? [{ id: 'handoff-1' }] : [],
    businessAccount: {
      connections: [{ id: 'connection-1', enabled: true, canReply: true }],
    },
  };
}

describe('business message read timing', () => {
  it('marks the customer message as read after a successful AI answer', async () => {
    const prisma = {
      conversation: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(conversation(ConversationMode.AI)),
      },
      message: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            senderType: SenderType.CUSTOMER,
            businessConnectionId: 'connection-1',
            telegramChatId: 123n,
            telegramMessageId: 10n,
            businessConnection: { rights: { can_read_messages: true } },
          }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const telegram = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 11, date: 1_700_000_000 }),
      readBusinessMessage: vi.fn().mockResolvedValue(undefined),
    };
    const messenger = new BusinessMessenger(
      prisma as never,
      telegram as never,
      testConfig({ TELEGRAM_MARK_READ: 'true' }),
      silentLogger,
    );

    await messenger.sendAiAnswer('conversation-1', 'answer', 'source-1');

    expect(telegram.readBusinessMessage).toHaveBeenCalledWith('connection-1', 123n, 10n);
  });

  it('keeps the customer message unread when sending a handoff acknowledgement', async () => {
    const prisma = {
      conversation: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(conversation(ConversationMode.HUMAN)),
      },
      message: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const telegram = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 11, date: 1_700_000_000 }),
      readBusinessMessage: vi.fn().mockResolvedValue(undefined),
    };
    const messenger = new BusinessMessenger(
      prisma as never,
      telegram as never,
      testConfig({ TELEGRAM_MARK_READ: 'true' }),
      silentLogger,
    );

    await messenger.sendHandoffAcknowledgement('conversation-1', 'handoff', 'source-1');

    expect(telegram.readBusinessMessage).not.toHaveBeenCalled();
  });
});
