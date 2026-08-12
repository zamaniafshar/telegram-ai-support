import { NotificationDeliveryStatus, NotificationSeverity } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AdminNotifier } from '../src/telegram-admin/notifier.js';
import { silentLogger, testConfig } from './helpers.js';

function setup(sendMessage = vi.fn().mockResolvedValue({ message_id: 77 })) {
  const delivery = {
    id: 'delivery-1',
    attempts: 1,
    maxAttempts: 8,
    admin: { telegramUserId: 123n },
    notification: {
      type: 'HANDOFF_ACTIVATED',
      titleFa: '🔔 ارجاع جدید',
      summaryFa: 'پیام مشتری برای بررسی انسانی ارجاع شد.',
      destinationPath: '/handoffs/conversation-1?business=business-1',
    },
  };
  const prisma = {
    notificationDelivery: {
      findMany: vi.fn().mockResolvedValue([{ id: delivery.id }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(delivery),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const notifier = new AdminNotifier(
    prisma as never,
    { sendMessage } as never,
    testConfig({ MINI_APP_URL: 'https://support.example.test/mini-app' }),
    silentLogger,
  );
  return { notifier, prisma, sendMessage };
}

describe('durable Admin Bot notifications', () => {
  it('delivers a concise Persian summary with exactly one authenticated Mini App details button', async () => {
    const { notifier, prisma, sendMessage } = setup();
    expect(await notifier.runBatch('worker-1')).toBe(1);

    expect(sendMessage).toHaveBeenCalledWith(
      123n,
      '🔔 ارجاع جدید\nپیام مشتری برای بررسی انسانی ارجاع شد.',
      {
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: 'مشاهده جزئیات',
                web_app: {
                  url: 'https://support.example.test/mini-app/handoffs/conversation-1?business=business-1',
                },
              },
            ],
          ],
        },
      },
    );
    expect(JSON.stringify(sendMessage.mock.calls[0]?.[2])).not.toContain('callback_data');
    expect(prisma.notificationDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: NotificationDeliveryStatus.DELIVERED }),
      }),
    );
  });

  it('keeps failed delivery durable for retry without leaking the error to Telegram', async () => {
    const { notifier, prisma } = setup(vi.fn().mockRejectedValue(new Error('network secret')));
    expect(await notifier.runBatch('worker-2')).toBe(1);

    expect(prisma.notificationDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.RETRY,
          lastErrorCode: expect.any(String),
        }),
      }),
    );
  });

  it('stores deduplicated notifications for authorized business recipients', async () => {
    const transaction = {
      notification: { upsert: vi.fn().mockResolvedValue({ id: 'notification-1' }) },
      admin: { findMany: vi.fn().mockResolvedValue([{ id: 'admin-1' }]) },
      notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const { notifier } = setup();
    await notifier.enqueue(transaction as never, {
      dedupeKey: 'HANDOFF_ACTIVATED:handoff-1',
      type: 'HANDOFF_ACTIVATED',
      severity: NotificationSeverity.WARNING,
      businessAccountId: 'business-1',
      relatedEntityType: 'Conversation',
      relatedEntityId: 'conversation-1',
      titleFa: 'ارجاع جدید',
      summaryFa: 'نیازمند رسیدگی است.',
      destinationPath: '/handoffs/conversation-1',
    });

    expect(transaction.admin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessAccess: { some: { businessAccountId: 'business-1' } },
        }),
      }),
    );
    expect(transaction.notificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });
});
