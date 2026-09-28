import type { Logger } from 'pino';
import type { BusinessConnectionUpdate, InlineKeyboardMarkup, SentTelegramMessage, TelegramWebhookInfo } from './types.js';
export interface SendMessageOptions {
    businessConnectionId?: string;
    replyMarkup?: InlineKeyboardMarkup;
    disableWebPagePreview?: boolean;
    parseMode?: 'HTML' | 'MarkdownV2';
}
export interface SendChatActionOptions {
    businessConnectionId?: string;
    signal?: AbortSignal;
}
export interface TelegramApi {
    sendMessage(chatId: bigint, text: string, options?: SendMessageOptions): Promise<SentTelegramMessage>;
    sendChatAction(chatId: bigint, action: 'typing', options?: SendChatActionOptions): Promise<void>;
    getBusinessConnection(id: string): Promise<BusinessConnectionUpdate>;
    readBusinessMessage(businessConnectionId: string, chatId: bigint, messageId: bigint): Promise<void>;
    setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<void>;
    deleteWebhook(dropPendingUpdates?: boolean): Promise<void>;
    getWebhookInfo(): Promise<TelegramWebhookInfo>;
    getMe(): Promise<{
        id: bigint;
        username?: string;
    }>;
    getUpdates(offset: number | undefined, allowedUpdates: string[], timeoutSeconds: number): Promise<unknown[]>;
}
export declare class TelegramBotApiClient implements TelegramApi {
    #private;
    private readonly timeoutMs;
    private readonly logger?;
    constructor(token: string, timeoutMs?: number, logger?: Logger | undefined);
    sendMessage(chatId: bigint, text: string, options?: SendMessageOptions): Promise<SentTelegramMessage>;
    sendChatAction(chatId: bigint, action: 'typing', options?: SendChatActionOptions): Promise<void>;
    getBusinessConnection(id: string): Promise<BusinessConnectionUpdate>;
    readBusinessMessage(businessConnectionId: string, chatId: bigint, messageId: bigint): Promise<void>;
    setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<void>;
    deleteWebhook(dropPendingUpdates?: boolean): Promise<void>;
    getWebhookInfo(): Promise<TelegramWebhookInfo>;
    getMe(): Promise<{
        id: bigint;
        username?: string;
    }>;
    getUpdates(offset: number | undefined, allowedUpdates: string[], timeoutSeconds: number): Promise<unknown[]>;
}
