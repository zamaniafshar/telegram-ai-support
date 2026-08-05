import { AdminRole, Prisma, TelegramBotKind, type Admin, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { KnowledgeService } from '../knowledge/service.js';
import type { HandoffService } from '../handoffs/service.js';
import type { AdminAuthorizer } from '../security/admin-authorization.js';
import type { TelegramApi } from '../telegram-business/client.js';
import type { InlineKeyboardMarkup, TelegramUpdate } from '../telegram-business/types.js';
import { AppError, AuthorizationError, ValidationError } from '../utils/errors.js';
import { newId, telegramId } from '../utils/ids.js';
import { hoursFrom } from '../utils/time.js';
import { fa } from './strings.js';
import { telegramUpdateIdentity } from '../telegram-business/idempotency.js';

interface HealthProvider {
  summary(): Promise<string>;
}

interface FlowData {
  businessAccountId?: string;
  knowledgeId?: string;
  title?: string;
  telegramUserId?: string;
}

export class AdminBotHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly telegram: TelegramApi,
    private readonly authorizer: AdminAuthorizer,
    private readonly knowledge: KnowledgeService,
    private readonly handoffs: HandoffService,
    private readonly health: HealthProvider,
    private readonly logger: Logger,
  ) {}

  async handle(update: TelegramUpdate, correlationId: string): Promise<void> {
    const actor = update.callback_query?.from ?? update.message?.from;
    if (!actor) return;
    let admin: Admin;
    try {
      admin = await this.authorizer.requireAdmin(telegramId(actor.id));
    } catch (error) {
      if (error instanceof AuthorizationError) {
        await this.telegram.sendMessage(telegramId(actor.id), fa.unauthorized);
        return;
      }
      throw error;
    }
    try {
      await this.prisma.processedTelegramUpdate.create({
        data: {
          id: telegramUpdateIdentity(TelegramBotKind.ADMIN, update.update_id),
          botKind: TelegramBotKind.ADMIN,
          updateId: telegramId(update.update_id),
          updateType: update.callback_query ? 'callback_query' : 'message',
          correlationId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }

    if (update.callback_query) {
      await this.telegram.answerCallbackQuery(update.callback_query.id).catch(() => undefined);
      await this.#runAdminAction(admin, telegramId(actor.id), () =>
        this.#callback(admin, update.callback_query?.data ?? '', telegramId(actor.id)),
      );
      return;
    }
    const text = update.message?.text?.trim();
    if (!text) return;
    if (text === '/start' || text === '/menu') {
      await this.#clearFlow(admin.id);
      await this.#menu(telegramId(actor.id), admin);
      return;
    }
    await this.#runAdminAction(admin, telegramId(actor.id), () =>
      this.#flowInput(admin, telegramId(actor.id), text),
    );
  }

  async #menu(chatId: bigint, admin: Admin): Promise<void> {
    const rows: InlineKeyboardMarkup['inline_keyboard'] = [
      [{ text: '🧑‍💼 ارجاع‌ها', callback_data: 'm:h' }],
      [
        { text: '🔌 اتصال تجاری', callback_data: 'm:b' },
        { text: '🩺 سلامت', callback_data: 'm:s' },
      ],
    ];
    if (admin.role !== AdminRole.SUPPORT) {
      rows.unshift([{ text: '📚 مدیریت دانش', callback_data: 'm:k' }]);
      rows.push([{ text: '🧾 گزارش ممیزی', callback_data: 'm:audit' }]);
    }
    if (admin.role === AdminRole.OWNER) {
      rows.push([{ text: '🔐 مدیران مجاز', callback_data: 'm:admins' }]);
    }
    await this.telegram.sendMessage(chatId, `${fa.menu}\n\n${fa.choose}`, {
      replyMarkup: { inline_keyboard: rows },
    });
  }

  async #callback(admin: Admin, data: string, chatId: bigint): Promise<void> {
    if (data === 'cancel' || data === 'back') {
      await this.#clearFlow(admin.id);
      await this.#menu(chatId, admin);
      return;
    }
    if (data === 'm:k') {
      this.#requireRole(admin, AdminRole.ADMIN);
      return this.#knowledgeMenu(chatId);
    }
    if (data === 'm:h') return this.#handoffList(admin, chatId);
    if (data === 'm:b') return this.#businessStatus(admin, chatId);
    if (data === 'm:s') {
      await this.telegram.sendMessage(chatId, await this.health.summary(), {
        replyMarkup: this.#back(),
      });
      return;
    }
    if (data === 'm:audit') {
      this.#requireRole(admin, AdminRole.ADMIN);
      return this.#audit(admin, chatId);
    }
    if (data === 'm:admins') return this.#admins(admin, chatId);
    if (data.startsWith('k:')) {
      this.#requireRole(admin, AdminRole.ADMIN);
      if (data === 'k:add') return this.#startAdd(admin, chatId);
      if (data === 'k:search')
        return this.#startFlow(
          admin.id,
          'KNOWLEDGE_SEARCH',
          'QUERY',
          {},
          chatId,
          'عبارت جستجو را بفرستید.',
        );
      if (data.startsWith('k:list:'))
        return this.#knowledgeList(admin, chatId, Number(data.split(':')[2] ?? 1));
      if (data.startsWith('k:view:'))
        return this.#knowledgeView(chatId, data.slice('k:view:'.length));
      if (data.startsWith('k:edit:'))
        return this.#knowledgeEditMenu(chatId, data.slice('k:edit:'.length));
      if (data.startsWith('k:et:'))
        return this.#startKnowledgeEdit(admin, chatId, data.slice('k:et:'.length), 'TITLE');
      if (data.startsWith('k:ed:'))
        return this.#startKnowledgeEdit(admin, chatId, data.slice('k:ed:'.length), 'DESCRIPTION');
      if (data.startsWith('k:toggle:'))
        return this.#toggleKnowledge(admin, chatId, data.slice('k:toggle:'.length));
      if (data.startsWith('k:del:'))
        return this.#confirmDelete(chatId, data.slice('k:del:'.length));
      if (data.startsWith('k:delc:'))
        return this.#deleteKnowledge(admin, chatId, data.slice('k:delc:'.length));
      if (data.startsWith('k:retry:'))
        return this.#retryKnowledge(chatId, data.slice('k:retry:'.length));
    }
    if (data.startsWith('h:ai:')) return this.#enableAi(admin, chatId, data.slice('h:ai:'.length));
    if (data.startsWith('h:ext:'))
      return this.#extendHuman(admin, chatId, data.slice('h:ext:'.length));
    if (data.startsWith('h:ack:'))
      return this.#acknowledge(admin, chatId, data.slice('h:ack:'.length));
    if (data.startsWith('h:msgs:'))
      return this.#recentMessages(admin, chatId, data.slice('h:msgs:'.length));
    if (data.startsWith('h:nochat:')) {
      await this.telegram.sendMessage(
        chatId,
        'برای این مشتری لینک مستقیم قابل اتکا نیست. شناسه و نام مشتری را از اعلان بردارید و گفتگو را در حساب اصلی پشتیبانی پیدا کنید.',
        { replyMarkup: this.#back() },
      );
      return;
    }
    if (data === 'a:add') return this.#startAdminAdd(admin, chatId);
    if (data.startsWith('a:role:'))
      return this.#finishAdminAdd(admin, chatId, data.slice('a:role:'.length));
    if (data.startsWith('a:off:'))
      return this.#confirmDeactivateAdmin(admin, chatId, data.slice('a:off:'.length));
    if (data.startsWith('a:offc:'))
      return this.#deactivateAdmin(admin, chatId, data.slice('a:offc:'.length));
    await this.telegram.sendMessage(chatId, fa.invalid, { replyMarkup: this.#back() });
  }

  async #knowledgeMenu(chatId: bigint): Promise<void> {
    await this.telegram.sendMessage(chatId, 'مدیریت دانش', {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '➕ افزودن', callback_data: 'k:add' },
            { text: '📋 فهرست', callback_data: 'k:list:1' },
          ],
          [{ text: '🔎 جستجو', callback_data: 'k:search' }],
          [{ text: '⬅️ بازگشت', callback_data: 'back' }],
        ],
      },
    });
  }

  async #startAdd(admin: Admin, chatId: bigint): Promise<void> {
    const business = await this.#firstBusiness(admin.id);
    await this.#startFlow(
      admin.id,
      'KNOWLEDGE_ADD',
      'TITLE',
      { businessAccountId: business.id },
      chatId,
      'عنوان کوتاه دانش را بفرستید.',
    );
  }

  async #knowledgeList(admin: Admin, chatId: bigint, page: number, query?: string): Promise<void> {
    const business = await this.#firstBusiness(admin.id);
    const result = await this.knowledge.list(business.id, Math.max(1, page), 8, query);
    if (result.items.length === 0) {
      await this.telegram.sendMessage(chatId, fa.noItems, { replyMarkup: this.#back() });
      return;
    }
    const rows = result.items.map((item) => [
      {
        text: `${item.isActive ? '✅' : '⏸'} ${item.title} [${item.indexingStatus}]`,
        callback_data: `k:view:${item.id}`,
      },
    ]);
    const navigation = [];
    if (page > 1) navigation.push({ text: '◀️', callback_data: `k:list:${page - 1}` });
    if (page * result.pageSize < result.total)
      navigation.push({ text: '▶️', callback_data: `k:list:${page + 1}` });
    if (navigation.length) rows.push(navigation);
    rows.push([{ text: '⬅️ بازگشت', callback_data: 'back' }]);
    await this.telegram.sendMessage(chatId, `دانش‌ها — صفحه ${page}`, {
      replyMarkup: { inline_keyboard: rows },
    });
  }

  async #knowledgeView(chatId: bigint, id: string): Promise<void> {
    const item = await this.knowledge.get(id);
    if (!item) throw new ValidationError('Knowledge not found');
    await this.telegram.sendMessage(
      chatId,
      [
        `عنوان: ${item.title}`,
        `فعال: ${item.isActive ? 'بله' : 'خیر'}`,
        `نسخه: ${item.version}`,
        `نمایه‌سازی: ${item.indexingStatus}`,
        '',
        item.description.slice(0, 3000),
      ].join('\n'),
      {
        replyMarkup: {
          inline_keyboard: [
            [
              { text: '✏️ ویرایش', callback_data: `k:edit:${item.id}` },
              {
                text: item.isActive ? '⏸ غیرفعال' : '▶️ فعال',
                callback_data: `k:toggle:${item.id}`,
              },
            ],
            [
              { text: '🔁 تلاش مجدد نمایه', callback_data: `k:retry:${item.id}` },
              { text: '🗑 حذف', callback_data: `k:del:${item.id}` },
            ],
            [{ text: '⬅️ بازگشت', callback_data: 'k:list:1' }],
          ],
        },
      },
    );
  }

  async #knowledgeEditMenu(chatId: bigint, id: string): Promise<void> {
    await this.telegram.sendMessage(chatId, 'کدام بخش ویرایش شود؟', {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: 'عنوان', callback_data: `k:et:${id}` },
            { text: 'توضیحات', callback_data: `k:ed:${id}` },
          ],
          [{ text: 'لغو', callback_data: 'cancel' }],
        ],
      },
    });
  }

  async #startKnowledgeEdit(
    admin: Admin,
    chatId: bigint,
    id: string,
    field: 'TITLE' | 'DESCRIPTION',
  ): Promise<void> {
    await this.#startFlow(
      admin.id,
      'KNOWLEDGE_EDIT',
      field,
      { knowledgeId: id },
      chatId,
      field === 'TITLE' ? 'عنوان جدید را بفرستید.' : 'توضیحات جدید را بفرستید.',
    );
  }

  async #toggleKnowledge(admin: Admin, chatId: bigint, id: string): Promise<void> {
    const item = await this.knowledge.get(id);
    if (!item) throw new ValidationError('Knowledge not found');
    await this.knowledge.setActive(id, !item.isActive, admin.id);
    await this.telegram.sendMessage(chatId, fa.saved, { replyMarkup: this.#back() });
  }

  async #confirmDelete(chatId: bigint, id: string): Promise<void> {
    await this.telegram.sendMessage(chatId, fa.confirmDelete, {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: 'بله، حذف شود', callback_data: `k:delc:${id}` },
            { text: 'لغو', callback_data: 'cancel' },
          ],
        ],
      },
    });
  }

  async #deleteKnowledge(admin: Admin, chatId: bigint, id: string): Promise<void> {
    await this.knowledge.delete(id, admin.id);
    await this.telegram.sendMessage(chatId, 'حذف شد و بردارهای آن از بازیابی خارج می‌شوند.', {
      replyMarkup: this.#back(),
    });
  }

  async #retryKnowledge(chatId: bigint, id: string): Promise<void> {
    await this.knowledge.retryIndexing(id);
    await this.telegram.sendMessage(chatId, 'کار نمایه‌سازی دوباره در صف قرار گرفت.', {
      replyMarkup: this.#back(),
    });
  }

  async #handoffList(admin: Admin, chatId: bigint): Promise<void> {
    const business = await this.#firstBusiness(admin.id);
    const items = await this.prisma.handoff.findMany({
      where: { conversation: { businessAccountId: business.id }, activeKey: { not: null } },
      include: { conversation: { include: { customer: true } } },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    if (!items.length) {
      await this.telegram.sendMessage(chatId, fa.noItems, { replyMarkup: this.#back() });
      return;
    }
    const rows = items.map((item) => [
      {
        text: `${item.status} — ${item.conversation.customer.telegramUserId.toString()}`,
        callback_data: `h:msgs:${item.conversationId}`,
      },
    ]);
    rows.push([{ text: '⬅️ بازگشت', callback_data: 'back' }]);
    await this.telegram.sendMessage(chatId, 'ارجاع‌های فعال', {
      replyMarkup: { inline_keyboard: rows },
    });
  }

  async #enableAi(admin: Admin, chatId: bigint, conversationId: string): Promise<void> {
    const changed = await this.handoffs.enableAiNow(conversationId, admin);
    await this.telegram.sendMessage(
      chatId,
      changed
        ? 'هوش مصنوعی فعال شد؛ پیامی برای مشتری ارسال نشد.'
        : 'حالت گفتگو قبلاً تغییر کرده است.',
      { replyMarkup: this.#back() },
    );
  }

  async #extendHuman(admin: Admin, chatId: bigint, conversationId: string): Promise<void> {
    const expiresAt = await this.handoffs.extend(conversationId, admin);
    await this.telegram.sendMessage(chatId, `حالت انسانی تا ${expiresAt.toISOString()} تمدید شد.`, {
      replyMarkup: this.#back(),
    });
  }

  async #acknowledge(admin: Admin, chatId: bigint, conversationId: string): Promise<void> {
    await this.handoffs.acknowledge(conversationId, admin);
    await this.telegram.sendMessage(chatId, 'ارجاع تأیید شد.', { replyMarkup: this.#back() });
  }

  async #recentMessages(admin: Admin, chatId: bigint, conversationId: string): Promise<void> {
    await this.#requireConversationAccess(admin.id, conversationId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'desc' },
      take: 20,
    });
    const text = [...messages]
      .reverse()
      .map(
        (message) =>
          `${message.senderType} | ${message.sentAt.toISOString()}\n${message.text ?? '[رسانه/حذف‌شده]'}`,
      )
      .join('\n\n');
    await this.telegram.sendMessage(chatId, text.slice(0, 3900) || fa.noItems, {
      replyMarkup: this.#back(),
    });
  }

  async #businessStatus(admin: Admin, chatId: bigint): Promise<void> {
    const business = await this.#firstBusiness(admin.id);
    const connections = await this.prisma.businessConnection.findMany({
      where: { businessAccountId: business.id },
    });
    const text = connections.length
      ? connections
          .map(
            (item) =>
              `ID: ${item.id}\nفعال: ${item.enabled ? 'بله' : 'خیر'}\nمجوز can_reply: ${item.canReply ? 'بله' : 'خیر'}\nآخرین تغییر: ${item.updatedAt.toISOString()}`,
          )
          .join('\n\n')
      : 'هنوز اتصال تجاری ثبت نشده است.';
    await this.telegram.sendMessage(chatId, text, { replyMarkup: this.#back() });
  }

  async #audit(admin: Admin, chatId: bigint): Promise<void> {
    const business = await this.#firstBusiness(admin.id);
    const logs = await this.prisma.auditLog.findMany({
      where: { businessAccountId: business.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const text = logs
      .map(
        (log) =>
          `${log.createdAt.toISOString()} | ${log.action} | ${log.entityType}:${log.entityId}`,
      )
      .join('\n');
    await this.telegram.sendMessage(chatId, text || fa.noItems, { replyMarkup: this.#back() });
  }

  async #admins(admin: Admin, chatId: bigint): Promise<void> {
    if (admin.role !== AdminRole.OWNER) throw new AuthorizationError();
    const admins = await this.prisma.admin.findMany({ orderBy: { createdAt: 'asc' } });
    const rows = admins
      .filter((item) => item.role !== AdminRole.OWNER && item.isActive)
      .map((item) => [
        {
          text: `غیرفعال‌سازی ${item.telegramUserId.toString()} (${item.role})`,
          callback_data: `a:off:${item.id}`,
        },
      ]);
    rows.push([{ text: '➕ افزودن مدیر', callback_data: 'a:add' }]);
    rows.push([{ text: '⬅️ بازگشت', callback_data: 'back' }]);
    const text = admins
      .map(
        (item) =>
          `${item.telegramUserId.toString()} — ${item.role} — ${item.isActive ? 'فعال' : 'غیرفعال'}`,
      )
      .join('\n');
    await this.telegram.sendMessage(chatId, text, { replyMarkup: { inline_keyboard: rows } });
  }

  async #startAdminAdd(admin: Admin, chatId: bigint): Promise<void> {
    if (admin.role !== AdminRole.OWNER) throw new AuthorizationError();
    await this.#startFlow(
      admin.id,
      'ADMIN_ADD',
      'TELEGRAM_ID',
      {},
      chatId,
      'شناسه عددی تلگرام مدیر جدید را بفرستید.',
    );
  }

  async #finishAdminAdd(admin: Admin, chatId: bigint, roleText: string): Promise<void> {
    if (admin.role !== AdminRole.OWNER) throw new AuthorizationError();
    if (roleText !== AdminRole.ADMIN && roleText !== AdminRole.SUPPORT)
      throw new ValidationError('Invalid role');
    const role = roleText;
    const flow = await this.prisma.adminFlowState.findUniqueOrThrow({
      where: { adminId: admin.id },
    });
    const data = flow.data as FlowData;
    if (flow.flow !== 'ADMIN_ADD' || !data.telegramUserId)
      throw new ValidationError('Admin flow expired');
    const business = await this.#firstBusiness(admin.id);
    const target = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.admin.upsert({
        where: { telegramUserId: BigInt(data.telegramUserId ?? '') },
        create: { id: newId(), telegramUserId: BigInt(data.telegramUserId ?? ''), role },
        update: { role, isActive: true },
      });
      await tx.adminBusinessAccount.upsert({
        where: { adminId_businessAccountId: { adminId: saved.id, businessAccountId: business.id } },
        create: { adminId: saved.id, businessAccountId: business.id },
        update: {},
      });
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId: business.id,
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'ADMIN_AUTHORIZED',
          entityType: 'Admin',
          entityId: saved.id,
          metadata: { role },
        },
      });
      return saved;
    });
    await this.#clearFlow(admin.id);
    await this.telegram.sendMessage(
      chatId,
      `مدیر ${target.telegramUserId.toString()} با نقش ${target.role} فعال شد.`,
      { replyMarkup: this.#back() },
    );
  }

  async #deactivateAdmin(admin: Admin, chatId: bigint, id: string): Promise<void> {
    if (admin.role !== AdminRole.OWNER || id === admin.id) throw new AuthorizationError();
    const target = await this.prisma.admin.findUniqueOrThrow({ where: { id } });
    if (target.role === AdminRole.OWNER) throw new AuthorizationError();
    await this.prisma.admin.update({ where: { id }, data: { isActive: false } });
    await this.telegram.sendMessage(chatId, 'دسترسی مدیر غیرفعال شد.', {
      replyMarkup: this.#back(),
    });
  }

  async #confirmDeactivateAdmin(admin: Admin, chatId: bigint, id: string): Promise<void> {
    if (admin.role !== AdminRole.OWNER || id === admin.id) throw new AuthorizationError();
    await this.telegram.sendMessage(chatId, 'دسترسی این مدیر غیرفعال شود؟', {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: 'تأیید غیرفعال‌سازی', callback_data: `a:offc:${id}` },
            { text: 'لغو', callback_data: 'cancel' },
          ],
        ],
      },
    });
  }

  async #flowInput(admin: Admin, chatId: bigint, text: string): Promise<void> {
    const flow = await this.prisma.adminFlowState.findUnique({ where: { adminId: admin.id } });
    if (!flow || flow.expiresAt <= new Date()) {
      await this.#clearFlow(admin.id);
      await this.#menu(chatId, admin);
      return;
    }
    const data = flow.data as FlowData;
    if (flow.flow === 'KNOWLEDGE_ADD' && flow.step === 'TITLE') {
      await this.prisma.adminFlowState.update({
        where: { adminId: admin.id },
        data: { step: 'DESCRIPTION', data: { ...data, title: text } },
      });
      await this.telegram.sendMessage(chatId, 'توضیحات کامل و قابل استناد را بفرستید.', {
        replyMarkup: this.#cancel(),
      });
      return;
    }
    if (
      flow.flow === 'KNOWLEDGE_ADD' &&
      flow.step === 'DESCRIPTION' &&
      data.businessAccountId &&
      data.title
    ) {
      const item = await this.knowledge.create(
        { businessAccountId: data.businessAccountId, title: data.title, description: text },
        admin.id,
      );
      await this.#clearFlow(admin.id);
      await this.telegram.sendMessage(
        chatId,
        `دانش «${item.title}» ذخیره و برای نمایه‌سازی صف شد.`,
        { replyMarkup: this.#back() },
      );
      return;
    }
    if (flow.flow === 'KNOWLEDGE_SEARCH') {
      await this.#clearFlow(admin.id);
      await this.#knowledgeList(admin, chatId, 1, text);
      return;
    }
    if (flow.flow === 'KNOWLEDGE_EDIT' && data.knowledgeId) {
      await this.knowledge.update(
        data.knowledgeId,
        flow.step === 'TITLE' ? { title: text } : { description: text },
        admin.id,
      );
      await this.#clearFlow(admin.id);
      await this.telegram.sendMessage(chatId, 'ویرایش ذخیره و نسخه جدید برای نمایه‌سازی صف شد.', {
        replyMarkup: this.#back(),
      });
      return;
    }
    if (flow.flow === 'ADMIN_ADD' && flow.step === 'TELEGRAM_ID') {
      if (!/^\d{1,20}$/.test(text)) throw new ValidationError('Invalid Telegram ID');
      await this.prisma.adminFlowState.update({
        where: { adminId: admin.id },
        data: { step: 'ROLE', data: { telegramUserId: text } },
      });
      await this.telegram.sendMessage(chatId, 'نقش را انتخاب کنید.', {
        replyMarkup: {
          inline_keyboard: [
            [
              { text: 'ADMIN', callback_data: 'a:role:ADMIN' },
              { text: 'SUPPORT', callback_data: 'a:role:SUPPORT' },
            ],
            [{ text: 'لغو', callback_data: 'cancel' }],
          ],
        },
      });
      return;
    }
    await this.telegram.sendMessage(chatId, fa.invalid, { replyMarkup: this.#cancel() });
  }

  async #startFlow(
    adminId: string,
    flow: string,
    step: string,
    data: FlowData,
    chatId: bigint,
    prompt: string,
  ): Promise<void> {
    await this.prisma.adminFlowState.upsert({
      where: { adminId },
      create: {
        id: newId(),
        adminId,
        flow,
        step,
        data: data as unknown as Prisma.InputJsonObject,
        expiresAt: hoursFrom(new Date(), 1),
      },
      update: {
        flow,
        step,
        data: data as unknown as Prisma.InputJsonObject,
        expiresAt: hoursFrom(new Date(), 1),
      },
    });
    await this.telegram.sendMessage(chatId, prompt, { replyMarkup: this.#cancel() });
  }

  async #clearFlow(adminId: string): Promise<void> {
    await this.prisma.adminFlowState.deleteMany({ where: { adminId } });
  }

  async #firstBusiness(adminId: string) {
    const access = await this.prisma.adminBusinessAccount.findFirst({
      where: { adminId },
      include: { businessAccount: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!access) throw new AuthorizationError('No business account assigned');
    return access.businessAccount;
  }

  async #requireConversationAccess(adminId: string, conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, businessAccount: { adminAccess: { some: { adminId } } } },
      select: { id: true },
    });
    if (!conversation) throw new AuthorizationError();
  }

  #back(): InlineKeyboardMarkup {
    return { inline_keyboard: [[{ text: '⬅️ بازگشت', callback_data: 'back' }]] };
  }

  #cancel(): InlineKeyboardMarkup {
    return { inline_keyboard: [[{ text: 'لغو', callback_data: 'cancel' }]] };
  }

  #requireRole(admin: Admin, minimum: AdminRole): void {
    const rank = { SUPPORT: 1, ADMIN: 2, OWNER: 3 } as const;
    if (rank[admin.role] < rank[minimum]) throw new AuthorizationError();
  }

  async #runAdminAction(admin: Admin, chatId: bigint, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof AppError) {
        this.logger.warn({ errorCode: error.code, adminId: admin.id }, 'admin action rejected');
        await this.telegram.sendMessage(
          chatId,
          error instanceof AuthorizationError
            ? fa.unauthorized
            : 'عملیات انجام نشد. ورودی یا وضعیت فعلی را بررسی و دوباره تلاش کنید.',
          { replyMarkup: this.#back() },
        );
        return;
      }
      throw error;
    }
  }
}
