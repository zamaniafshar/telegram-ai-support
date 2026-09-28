import { Prisma, TelegramBotKind, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AdminAuthorizer } from '../security/admin-authorization.js';
import type { TelegramApi } from '../telegram-business/client.js';
import { telegramUpdateIdentity } from '../telegram-business/idempotency.js';
import type { TelegramUpdate } from '../telegram-business/types.js';
import { AuthorizationError } from '../utils/errors.js';
import { telegramId } from '../utils/ids.js';
import { adminBotText } from './strings.js';

/**
 * The Admin Bot is intentionally only an authenticated entry point. All
 * management state and actions live in the Mini App.
 */
export class AdminBotHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly telegram: TelegramApi,
    private readonly authorizer: AdminAuthorizer,
    private readonly miniAppUrl: string,
    private readonly logger?: Logger,
  ) {}

  async handle(update: TelegramUpdate, correlationId: string): Promise<void> {
    const actor = update.message?.from;
    if (!actor) return;
    const chatId = telegramId(actor.id);
    this.logger?.trace(
      {
        category: 'TELEGRAM',
        botKind: 'ADMIN',
        updateId: update.update_id,
        actorId: actor.id,
        correlationId,
      },
      'admin bot update received',
    );
    try {
      await this.authorizer.requireAdmin(chatId);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        this.logger?.warn(
          {
            category: 'TELEGRAM',
            botKind: 'ADMIN',
            updateId: update.update_id,
            chatId: chatId.toString(),
          },
          'admin bot unauthorized access attempt',
        );
        await this.telegram.sendMessage(chatId, adminBotText.unauthorized);
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
          updateType: 'message',
          correlationId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }

    await this.telegram.sendMessage(chatId, adminBotText.launch, {
      replyMarkup: {
        inline_keyboard: [[{ text: 'باز کردن پنل مدیریت', web_app: { url: this.miniAppUrl } }]],
      },
    });
    this.logger?.trace(
      {
        category: 'TELEGRAM',
        botKind: 'ADMIN',
        updateId: update.update_id,
        chatId: chatId.toString(),
      },
      'admin bot launch button sent successfully',
    );
  }
}
