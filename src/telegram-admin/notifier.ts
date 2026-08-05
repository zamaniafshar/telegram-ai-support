import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { TelegramApi } from '../telegram-business/client.js';
import type { InlineKeyboardMarkup } from '../telegram-business/types.js';
import type { IndexingFailureNotifier } from '../indexing/service.js';
import type { ModeChangeNotifier } from '../handoffs/service.js';
import { remainingDuration } from '../utils/time.js';

export class AdminNotifier implements IndexingFailureNotifier, ModeChangeNotifier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly telegram: TelegramApi,
    private readonly logger: Logger,
  ) {}

  async handoffActivated(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        customer: true,
        messages: { orderBy: { sentAt: 'desc' }, take: 6 },
        handoffs: { where: { activeKey: { not: null } }, take: 1 },
      },
    });
    const handoff = conversation.handoffs[0];
    if (!handoff) return;
    const customerName =
      [conversation.customer.firstName, conversation.customer.lastName].filter(Boolean).join(' ') ||
      'بدون نام';
    const context = [...conversation.messages]
      .reverse()
      .map((message) => `${message.senderType}: ${(message.text ?? '[رسانه]').slice(0, 250)}`)
      .join('\n');
    const latest = conversation.messages[0]?.text ?? '[پیام غیرمتنی]';
    const replyWindow = conversation.telegramReplyWindowExpiresAt
      ? remainingDuration(conversation.telegramReplyWindowExpiresAt)
      : 'بسته';
    const usernameLine = conversation.customer.username
      ? `@${conversation.customer.username}`
      : 'ندارد؛ گفتگو را در حساب پشتیبانی با شناسه زیر پیدا کنید.';
    const text = [
      '🔔 ارجاع به پشتیبانی انسانی',
      `نام: ${customerName}`,
      `نام کاربری: ${usernameLine}`,
      `شناسه تلگرام: ${conversation.customer.telegramUserId.toString()}`,
      `آخرین پیام: ${latest.slice(0, 700)}`,
      `دلیل: ${handoff.reasonCode}${handoff.reasonDetail ? ` — ${handoff.reasonDetail}` : ''}`,
      `زمان ارجاع: ${handoff.startedAt.toISOString()}`,
      `پایان حالت انسانی: ${handoff.expiresAt.toISOString()}`,
      `زمان باقی‌مانده پنجره پاسخ ربات تلگرام: ${replyWindow}`,
      '',
      'متن اخیر:',
      context || 'پیامی موجود نیست.',
      '',
      'پاسخ را فقط از گفتگوی واقعی مشتری در حساب پشتیبانی ارسال کنید؛ ربات مدیریت امکان پاسخ به مشتری ندارد.',
    ].join('\n');
    const openButton = conversation.customer.username
      ? { text: 'Open Customer Chat', url: `https://t.me/${conversation.customer.username}` }
      : { text: 'Open Customer Chat', callback_data: `h:nochat:${conversation.id}` };
    await this.#broadcast(conversation.businessAccountId, text, {
      inline_keyboard: [
        [openButton],
        [
          { text: 'Enable AI Now', callback_data: `h:ai:${conversation.id}` },
          { text: 'Keep Human for Another 24 Hours', callback_data: `h:ext:${conversation.id}` },
        ],
        [
          { text: 'View Recent Messages', callback_data: `h:msgs:${conversation.id}` },
          { text: 'Acknowledge Handoff', callback_data: `h:ack:${conversation.id}` },
        ],
      ],
    });
  }

  async additionalCustomerMessage(conversationId: string, message: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { customer: true },
    });
    await this.#broadcast(
      conversation.businessAccountId,
      `پیام جدید در گفتگوی انسانی از ${conversation.customer.telegramUserId.toString()}:\n${message.slice(0, 1500)}`,
      {
        inline_keyboard: [
          [
            { text: 'View Recent Messages', callback_data: `h:msgs:${conversation.id}` },
            { text: 'Enable AI Now', callback_data: `h:ai:${conversation.id}` },
          ],
        ],
      },
    );
  }

  async aiRestored(conversationId: string, automatic: boolean): Promise<void> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { customer: true },
    });
    await this.#broadcast(
      conversation.businessAccountId,
      `${automatic ? '⏱' : '✅'} حالت هوش مصنوعی برای گفتگوی ${conversation.customer.telegramUserId.toString()} ${
        automatic ? 'پس از پایان ۲۴ ساعت به‌طور خودکار' : 'به‌صورت دستی'
      } فعال شد. پیامی برای مشتری ارسال نشد.`,
    );
  }

  async indexingFailed(input: {
    businessAccountId: string;
    knowledgeId: string;
    title: string;
    errorCode: string;
  }): Promise<void> {
    await this.#broadcast(
      input.businessAccountId,
      `❌ نمایه‌سازی دانش «${input.title}» ناموفق شد. کد خطا: ${input.errorCode}`,
      {
        inline_keyboard: [
          [{ text: 'Retry Indexing', callback_data: `k:retry:${input.knowledgeId}` }],
        ],
      },
    );
  }

  async systemAttention(businessAccountId: string, text: string): Promise<void> {
    await this.#broadcast(businessAccountId, `⚠️ نیاز به بررسی مدیر:\n${text.slice(0, 2000)}`);
  }

  async #broadcast(
    businessAccountId: string,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    const recipients = await this.prisma.admin.findMany({
      where: {
        isActive: true,
        businessAccess: { some: { businessAccountId } },
      },
      select: { telegramUserId: true },
    });
    const results = await Promise.allSettled(
      recipients.map((admin) =>
        this.telegram.sendMessage(
          admin.telegramUserId,
          text.slice(0, 4_000),
          replyMarkup ? { replyMarkup } : {},
        ),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          { err: result.reason, adminTelegramId: recipients[index]?.telegramUserId.toString() },
          'admin notification failed',
        );
      }
    });
  }
}
