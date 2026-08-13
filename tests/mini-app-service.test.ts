import { AdminRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MiniAppManagementService } from '../src/mini-app/service.js';
import { testConfig } from './helpers.js';

describe('Mini App management service', () => {
  it('returns a JSON-safe dashboard business projection instead of the raw database record', async () => {
    const business = {
      id: 'business-1',
      name: 'پشتیبانی',
      defaultLocale: 'fa',
      isActive: true,
      telegramAccountUserId: 123456789n,
    };
    const prisma = {
      handoff: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      conversation: { count: vi.fn().mockResolvedValue(0) },
      businessConnection: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new MiniAppManagementService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      testConfig(),
    );
    const context = {
      admin: { role: AdminRole.SUPPORT },
      businessAccess: [{ businessAccountId: business.id, businessAccount: business }],
    };

    const dashboard = await service.dashboard(context as never, business.id);

    expect(dashboard.business).toEqual({ id: business.id, name: business.name, locale: 'fa' });
    expect(() => JSON.stringify(dashboard)).not.toThrow();
    expect(dashboard.business).not.toHaveProperty('telegramAccountUserId');
  });

  it('merges all conversations into the handoff list and puts waiting chats first', async () => {
    const now = new Date();
    const customer = {
      firstName: 'مشتری',
      lastName: null,
      username: 'customer',
      telegramUserId: 10n,
    };
    const conversations = [
      {
        id: 'regular-chat',
        mode: 'AI',
        updatedAt: new Date(now.getTime() + 2_000),
        telegramReplyWindowExpiresAt: null,
        customer,
        handoffs: [],
        messages: [{ id: 'message-2', text: 'پیام عادی', senderType: 'CUSTOMER', sentAt: now }],
      },
      {
        id: 'waiting-chat',
        mode: 'HUMAN',
        updatedAt: now,
        telegramReplyWindowExpiresAt: null,
        customer,
        handoffs: [
          {
            id: 'handoff-1',
            status: 'WAITING',
            reasonCode: 'AI_NOT_ANSWERABLE',
            startedAt: now,
            expiresAt: new Date(now.getTime() + 60_000),
            claimedBy: null,
          },
        ],
        messages: [
          { id: 'message-1', text: 'نیازمند رسیدگی', senderType: 'CUSTOMER', sentAt: now },
        ],
      },
    ];
    const prisma = { conversation: { findMany: vi.fn().mockResolvedValue(conversations) } };
    const service = new MiniAppManagementService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      testConfig(),
    );
    const context = {
      admin: { role: AdminRole.SUPPORT },
      businessAccess: [
        { businessAccountId: 'business-1', businessAccount: { id: 'business-1', isActive: true } },
      ],
    };

    const result = await service.listHandoffs(context as never, 'business-1', {});

    expect(result.map((item) => item.conversationId)).toEqual(['waiting-chat', 'regular-chat']);
    expect(result[1]).toMatchObject({ status: 'NONE', lastMessage: { text: 'پیام عادی' } });
  });

  it('returns conversation messages newest first in the merged detail page', async () => {
    const newer = new Date('2026-08-12T10:01:00Z');
    const older = new Date('2026-08-12T10:00:00Z');
    const messages = [
      { id: 'newer', senderType: 'CUSTOMER', text: 'جدید', sentAt: newer, editedAt: null },
      { id: 'older', senderType: 'AI', text: 'قدیمی', sentAt: older, editedAt: null },
    ];
    const prisma = {
      conversation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'conversation-1',
          mode: 'AI',
          humanModeExpiresAt: null,
          telegramReplyWindowExpiresAt: null,
          customer: {
            firstName: 'مشتری',
            lastName: null,
            username: null,
            telegramUserId: 10n,
            languageCode: 'fa',
          },
          handoffs: [],
          messages,
        }),
      },
    };
    const service = new MiniAppManagementService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      testConfig(),
    );
    const context = {
      admin: { role: AdminRole.SUPPORT },
      businessAccess: [
        { businessAccountId: 'business-1', businessAccount: { id: 'business-1', isActive: true } },
      ],
    };

    const result = await service.handoffDetails(context as never, 'business-1', 'conversation-1');

    expect(result.messages.map((message) => message.id)).toEqual(['newer', 'older']);
  });
});
