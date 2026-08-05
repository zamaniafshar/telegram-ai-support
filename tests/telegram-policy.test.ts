import { ConversationMode } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { canSendAiReply } from '../src/conversations/policy.js';
import { classifyBusinessMessage } from '../src/telegram-business/ingest.js';
import { telegramUpdateIdentity } from '../src/telegram-business/idempotency.js';
import { TelegramBotKind } from '@prisma/client';

const baseMessage = {
  message_id: 10,
  date: 1_700_000_000,
  chat: { id: 123, type: 'private' as const },
};

describe('Telegram Business sender detection', () => {
  it('detects AI outgoing messages using sender_business_bot', () => {
    expect(
      classifyBusinessMessage(
        {
          ...baseMessage,
          from: { id: 99, is_bot: false },
          sender_business_bot: { id: 88, is_bot: true },
        },
        99n,
      ),
    ).toEqual({ senderType: 'AI', direction: 'OUTGOING' });
  });

  it('detects manual human outgoing messages without the bot marker', () => {
    expect(
      classifyBusinessMessage({ ...baseMessage, from: { id: 99, is_bot: false } }, 99n),
    ).toEqual({ senderType: 'HUMAN', direction: 'OUTGOING' });
  });

  it('never treats a customer incoming message as outgoing', () => {
    expect(
      classifyBusinessMessage({ ...baseMessage, from: { id: 123, is_bot: false } }, 99n).senderType,
    ).toBe('CUSTOMER');
  });
});

describe('Telegram send preconditions', () => {
  const future = new Date(Date.now() + 60_000);

  it('rejects a disabled business connection', () => {
    expect(
      canSendAiReply({
        mode: ConversationMode.AI,
        connectionEnabled: false,
        canReply: true,
        replyWindowExpiresAt: future,
      }).reason,
    ).toBe('BUSINESS_CONNECTION_DISABLED');
  });

  it('rejects missing can_reply permission', () => {
    expect(
      canSendAiReply({
        mode: ConversationMode.AI,
        connectionEnabled: true,
        canReply: false,
        replyWindowExpiresAt: future,
      }).reason,
    ).toBe('BUSINESS_CAN_REPLY_MISSING');
  });

  it('rejects an expired Telegram reply window independently of human mode', () => {
    expect(
      canSendAiReply({
        mode: ConversationMode.AI,
        connectionEnabled: true,
        canReply: true,
        replyWindowExpiresAt: new Date(Date.now() - 1),
      }).reason,
    ).toBe('TELEGRAM_REPLY_WINDOW_EXPIRED');
  });

  it('creates bot-scoped idempotency identities', () => {
    expect(telegramUpdateIdentity(TelegramBotKind.BUSINESS, 42)).toBe('BUSINESS:42');
    expect(telegramUpdateIdentity(TelegramBotKind.ADMIN, 42)).toBe('ADMIN:42');
  });
});
