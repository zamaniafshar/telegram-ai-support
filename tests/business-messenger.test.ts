import { ConversationMode, SenderType } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('business typing indicator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows typing during processing and stops refreshing when processing finishes', async () => {
    vi.useFakeTimers();
    const prisma = {
      conversation: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(conversation(ConversationMode.AI)),
      },
    };
    const telegram = {
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    };
    const messenger = new BusinessMessenger(
      prisma as never,
      telegram as never,
      testConfig(),
      silentLogger,
    );
    let finishOperation: ((value: string) => void) | undefined;
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishOperation = resolve;
        }),
    );

    const resultPromise = messenger.whileTyping('conversation-1', operation);
    await vi.advanceTimersByTimeAsync(0);

    expect(telegram.sendChatAction).toHaveBeenCalledWith(
      123n,
      'typing',
      expect.objectContaining({ businessConnectionId: 'connection-1' }),
    );
    const firstOptions = telegram.sendChatAction.mock.calls[0]?.[2] as
      { signal: AbortSignal } | undefined;
    expect(firstOptions?.signal.aborted).toBe(false);
    expect(telegram.sendChatAction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(telegram.sendChatAction).toHaveBeenCalledTimes(3);

    finishOperation?.('answer');
    await expect(resultPromise).resolves.toBe('answer');
    expect(firstOptions?.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(telegram.sendChatAction).toHaveBeenCalledTimes(3);
  });

  it('does not let a rejected typing action fail processing', async () => {
    const prisma = {
      conversation: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(conversation(ConversationMode.AI)),
      },
    };
    const telegram = {
      sendChatAction: vi.fn().mockRejectedValue(new Error('Telegram unavailable')),
    };
    const messenger = new BusinessMessenger(
      prisma as never,
      telegram as never,
      testConfig(),
      silentLogger,
    );

    await expect(messenger.whileTyping('conversation-1', async () => 'answer')).resolves.toBe(
      'answer',
    );
  });
});

describe('business AI message formatting and splitting', () => {
  it('sends AI answer with HTML parse mode', async () => {
    const prisma = {
      conversation: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(conversation(ConversationMode.AI)),
      },
      message: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const telegram = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 21, date: 1_700_000_000 }),
    };
    const messenger = new BusinessMessenger(
      prisma as never,
      telegram as never,
      testConfig(),
      silentLogger,
    );

    await messenger.sendAiAnswer('conversation-1', 'سلام! <b>دوره جامع</b>', 'source-1');

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      123n,
      'سلام! <b>دوره جامع</b>',
      expect.objectContaining({
        businessConnectionId: 'connection-1',
        parseMode: 'HTML',
      }),
    );
  });

  it('falls back to plain text if Telegram rejects HTML parsing', async () => {
    const prisma = {
      conversation: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(conversation(ConversationMode.AI)),
      },
      message: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const telegram = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error("Telegram 400: Bad Request: can't parse entities"))
        .mockResolvedValueOnce({ message_id: 22, date: 1_700_000_000 }),
    };
    const messenger = new BusinessMessenger(
      prisma as never,
      telegram as never,
      testConfig(),
      silentLogger,
    );

    await messenger.sendAiAnswer('conversation-1', '<b>متن تست</b>', 'source-1');

    expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(
      123n,
      'متن تست',
      expect.objectContaining({
        businessConnectionId: 'connection-1',
      }),
    );
  });

  it('splits long responses and sends consecutive parts with typing action', async () => {
    vi.useFakeTimers();
    const prisma = {
      conversation: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(conversation(ConversationMode.AI)),
      },
      message: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const telegram = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 31, date: 1_700_000_000 }),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    };
    const messenger = new BusinessMessenger(
      prisma as never,
      telegram as never,
      testConfig(),
      silentLogger,
    );

    const longAnswer =
      'بخش اول: توضیحات کامل درباره دوره‌های جامع بیوشیمی ویژه کنکور کارشناسی ارشد و دکتری به همراه آزمون‌های کلاسی پایان هر فصل و جزوه چاپی اختصاصی.\n\n' +
      'بخش دوم: شرایط ثبت‌نام و دسترسی نرم‌افزار اسپات‌پلیر با لایسنس اختصاصی تک‌کاربره برای کامپیوتر یا موبایل و نحوه ارسال فیزیکی جزوات از طریق شرکت تیپاکس.\n\n' +
      'بخش سوم: جهت راهنمایی دقیق‌تر و ثبت‌نام در کلاس، لطفاً بفرمایید داوطلب کنکور ۱۴۰۵ هستید یا کنکور ۱۴۰۶ تا اطلاعات و شرایط تخفیف دوره مربوطه خدمتتون ارسال بشه.';

    const sendPromise = messenger.sendAiAnswer('conversation-1', longAnswer, 'source-1');
    await vi.runAllTimersAsync();
    await sendPromise;

    expect(telegram.sendMessage).toHaveBeenCalledTimes(3);
    expect(telegram.sendChatAction).toHaveBeenCalledWith(
      123n,
      'typing',
      expect.objectContaining({ businessConnectionId: 'connection-1' }),
    );
    vi.useRealTimers();
  });
});

