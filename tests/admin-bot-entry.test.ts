import { AdminRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AdminBotHandler } from '../src/telegram-admin/handler.js';
import { AuthorizationError } from '../src/utils/errors.js';

const admin = {
  id: 'admin-1',
  telegramUserId: 123n,
  displayName: 'مدیر',
  role: AdminRole.ADMIN,
  isActive: true,
  locale: 'fa',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function update(updateId = 1) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: 123, type: 'private' },
      from: { id: 123, is_bot: false, first_name: 'مدیر' },
      text: '/start',
    },
  };
}

function setup(requireAdmin = vi.fn().mockResolvedValue(admin)) {
  const prisma = {
    processedTelegramUpdate: { create: vi.fn().mockResolvedValue({}) },
  };
  const telegram = { sendMessage: vi.fn().mockResolvedValue(undefined) };
  const handler = new AdminBotHandler(
    prisma as never,
    telegram as never,
    { requireAdmin } as never,
    'https://support.example.test/mini-app',
  );
  return { handler, prisma, telegram, requireAdmin };
}

describe('Admin Bot Mini App entry point', () => {
  it('shows exactly one Persian web-app launch button and no state-changing callback', async () => {
    const { handler, telegram } = setup();
    await handler.handle(update() as never, 'request-1');

    expect(telegram.sendMessage).toHaveBeenCalledOnce();
    const options = telegram.sendMessage.mock.calls[0]?.[2] as
      { replyMarkup?: unknown } | undefined;
    expect(options?.replyMarkup).toEqual({
      inline_keyboard: [
        [
          {
            text: 'باز کردن پنل مدیریت',
            web_app: { url: 'https://support.example.test/mini-app' },
          },
        ],
      ],
    });
    expect(JSON.stringify(options)).not.toContain('callback_data');
    expect(JSON.stringify(options)).not.toContain('reply_keyboard');
  });

  it('rejects inactive or unknown Telegram users without a launch button', async () => {
    const { handler, telegram } = setup(vi.fn().mockRejectedValue(new AuthorizationError()));
    await handler.handle(update() as never, 'request-2');

    expect(telegram.sendMessage).toHaveBeenCalledWith(123n, 'دسترسی شما به این ربات مجاز نیست.');
  });

  it('ignores callback updates because management callbacks no longer exist', async () => {
    const { handler, telegram, requireAdmin } = setup();
    await handler.handle({ update_id: 3 } as never, 'request-3');

    expect(requireAdmin).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });
});
