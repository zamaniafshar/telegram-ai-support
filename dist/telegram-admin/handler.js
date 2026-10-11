import { Prisma, TelegramBotKind } from '@prisma/client';
import { telegramUpdateIdentity } from '../telegram-business/idempotency.js';
import { AuthorizationError } from '../utils/errors.js';
import { telegramId } from '../utils/ids.js';
import { adminBotText } from './strings.js';
/**
 * The Admin Bot is intentionally only an authenticated entry point. All
 * management state and actions live in the Mini App.
 */
export class AdminBotHandler {
    prisma;
    telegram;
    authorizer;
    miniAppUrl;
    logger;
    constructor(prisma, telegram, authorizer, miniAppUrl, logger) {
        this.prisma = prisma;
        this.telegram = telegram;
        this.authorizer = authorizer;
        this.miniAppUrl = miniAppUrl;
        this.logger = logger;
    }
    async handle(update, correlationId) {
        const actor = update.message?.from;
        if (!actor)
            return;
        const chatId = telegramId(actor.id);
        this.logger?.trace({
            category: 'TELEGRAM',
            botKind: 'ADMIN',
            updateId: update.update_id,
            actorId: actor.id,
            correlationId,
        }, 'admin bot update received');
        try {
            await this.authorizer.requireAdmin(chatId);
        }
        catch (error) {
            if (error instanceof AuthorizationError) {
                this.logger?.warn({
                    category: 'TELEGRAM',
                    botKind: 'ADMIN',
                    updateId: update.update_id,
                    chatId: chatId.toString(),
                }, 'admin bot unauthorized access attempt');
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
        }
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
                return;
            throw error;
        }
        await this.telegram.sendMessage(chatId, adminBotText.launch, {
            replyMarkup: {
                inline_keyboard: [
                    [{ text: 'باز کردن پنل مدیریت', web_app: { url: this.miniAppUrl.replace(/^http:\/\//i, 'https://') } }],
                ],
            },
        });
        this.logger?.trace({
            category: 'TELEGRAM',
            botKind: 'ADMIN',
            updateId: update.update_id,
            chatId: chatId.toString(),
        }, 'admin bot launch button sent successfully');
    }
}
//# sourceMappingURL=handler.js.map