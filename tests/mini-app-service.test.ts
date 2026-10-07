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

  it('delegates systemLogs, systemLogDetail, and diagnostics to SystemLogRepository', async () => {
    const mockRepo = {
      list: vi.fn().mockResolvedValue({
        items: [{ id: 'log-1', message: 'test log' }],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      }),
      get: vi.fn().mockResolvedValue({
        id: 'log-1',
        businessAccountId: 'business-1',
        message: 'test log',
      }),
      summary: vi.fn().mockResolvedValue({
        byLevel: { ERROR: 1 },
        byCategory: { AI: 1 },
        topErrors: [],
        recentErrors: [],
      }),
    };

    const prisma = {
      indexingJob: { groupBy: vi.fn().mockResolvedValue([]) },
      conversationJob: { groupBy: vi.fn().mockResolvedValue([]) },
    };

    const health = {
      readiness: vi.fn().mockResolvedValue({ status: 'ok' }),
    };

    const service = new MiniAppManagementService(
      prisma as never,
      {} as never,
      {} as never,
      health as never,
      testConfig(),
      undefined,
      undefined,
      mockRepo as never,
    );

    const adminContext = {
      admin: { role: AdminRole.ADMIN },
      businessAccess: [
        { businessAccountId: 'business-1', businessAccount: { id: 'business-1', isActive: true } },
      ],
    };

    // 1. systemLogs
    const listResult = await service.systemLogs(adminContext as never, 'business-1', { page: '1' });
    expect(mockRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({ businessAccountId: 'business-1', page: 1, pageSize: 20 }),
    );
    expect(listResult.items).toHaveLength(1);

    // 2. systemLogDetail
    const detail = await service.systemLogDetail(adminContext as never, 'business-1', 'log-1');
    expect(mockRepo.get).toHaveBeenCalledWith('log-1');
    expect(detail).toEqual(expect.objectContaining({ id: 'log-1' }));

    // 3. diagnostics
    const diag = await service.diagnostics(adminContext as never, 'business-1');
    expect(mockRepo.summary).toHaveBeenCalledWith({
      businessAccountId: 'business-1',
      sinceHours: 24,
    });
    expect(diag.logs).toEqual(expect.objectContaining({ byLevel: { ERROR: 1 } }));
  });

  it('lists exact answers alongside published and draft knowledge items', async () => {
    const knowledge = {
      list: vi.fn().mockResolvedValue({
        items: [{ id: 'k-1', title: 'شرایط گارانتی', description: 'متن گارانتی' }],
      }),
      listDrafts: vi
        .fn()
        .mockResolvedValue([{ id: 'd-1', title: 'پیش‌نویس گارانتی', description: 'متن پیش‌نویس' }]),
    };
    const exactAnswers = {
      list: vi.fn().mockResolvedValue([
        {
          id: 'exact-1',
          name: 'شماره کارت',
          content: '۶۰۳۷۹۹...',
          isActive: true,
          questions: [{ id: 'q-1', questionText: 'شماره کارت بدید', isActive: true }],
        },
      ]),
    };
    const service = new MiniAppManagementService(
      {} as never,
      knowledge as never,
      {} as never,
      {} as never,
      testConfig(),
      undefined,
      undefined,
      undefined,
      exactAnswers as never,
    );
    const context = {
      admin: { id: 'admin-1', role: AdminRole.ADMIN },
      businessAccess: [
        { businessAccountId: 'biz-1', businessAccount: { id: 'biz-1', isActive: true } },
      ],
    };

    const result = await service.listKnowledge(context as never, 'biz-1', { query: 'کارت' });

    expect(knowledge.list).toHaveBeenCalledWith('biz-1', 1, 100, 'کارت');
    expect(exactAnswers.list).toHaveBeenCalledWith('biz-1', 'کارت');
    expect(result.exactAnswers).toHaveLength(1);
    expect(result.exactAnswers[0]?.name).toBe('شماره کارت');
  });

  it('handles exact answer CRUD operations in MiniAppManagementService', async () => {
    const exactAnswers = {
      create: vi.fn().mockResolvedValue({ id: 'exact-1', name: 'ارسال رایگان' }),
      get: vi.fn().mockResolvedValue({
        id: 'exact-1',
        name: 'ارسال رایگان',
        content: 'ارسال رایگان بالای ۵۰۰ هزار',
      }),
      update: vi.fn().mockResolvedValue({ id: 'exact-1', isActive: false }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new MiniAppManagementService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      testConfig(),
      undefined,
      undefined,
      undefined,
      exactAnswers as never,
    );
    const context = {
      admin: { id: 'admin-1', role: AdminRole.ADMIN },
      businessAccess: [
        { businessAccountId: 'biz-1', businessAccount: { id: 'biz-1', isActive: true } },
      ],
    };

    // create
    const created = await service.createExactAnswer(context as never, 'biz-1', {
      name: 'ارسال رایگان',
      content: 'ارسال رایگان بالای ۵۰۰ هزار',
      questions: ['هزینه ارسال چقدره؟'],
    });
    expect(created.id).toBe('exact-1');
    expect(exactAnswers.create).toHaveBeenCalledWith({
      businessAccountId: 'biz-1',
      name: 'ارسال رایگان',
      content: 'ارسال رایگان بالای ۵۰۰ هزار',
      questions: ['هزینه ارسال چقدره؟'],
      adminId: 'admin-1',
      isActive: true,
    });

    // details
    const details = await service.exactAnswerDetails(context as never, 'biz-1', 'exact-1');
    expect(details.id).toBe('exact-1');

    // active toggle
    await service.setExactAnswerActive(context as never, 'biz-1', 'exact-1', false);
    expect(exactAnswers.update).toHaveBeenCalledWith('exact-1', 'biz-1', {
      isActive: false,
      adminId: 'admin-1',
    });

    // delete
    const delResult = await service.deleteExactAnswer(context as never, 'biz-1', 'exact-1');
    expect(delResult).toEqual({ ok: true });
    expect(exactAnswers.delete).toHaveBeenCalledWith('exact-1', 'biz-1');
  });
});
