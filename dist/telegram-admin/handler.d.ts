import { type PrismaClient } from '@prisma/client';
import type { AdminAuthorizer } from '../security/admin-authorization.js';
import type { TelegramApi } from '../telegram-business/client.js';
import type { TelegramUpdate } from '../telegram-business/types.js';
/**
 * The Admin Bot is intentionally only an authenticated entry point. All
 * management state and actions live in the Mini App.
 */
export declare class AdminBotHandler {
    private readonly prisma;
    private readonly telegram;
    private readonly authorizer;
    private readonly miniAppUrl;
    constructor(prisma: PrismaClient, telegram: TelegramApi, authorizer: AdminAuthorizer, miniAppUrl: string);
    handle(update: TelegramUpdate, correlationId: string): Promise<void>;
}
