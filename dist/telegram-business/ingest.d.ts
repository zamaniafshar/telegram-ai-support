import { MessageDirection, SenderType, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { TelegramMessage, TelegramUpdate } from './types.js';
import type { TelegramApi } from './client.js';
export interface IngestResult {
    duplicate: boolean;
    type: string;
    conversationId?: string;
    messageId?: string;
}
export declare function classifyBusinessMessage(message: TelegramMessage, businessAccountTelegramId: bigint | null): {
    senderType: SenderType;
    direction: MessageDirection;
};
export declare class BusinessUpdateIngestor {
    #private;
    private readonly prisma;
    private readonly telegram;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaClient, telegram: TelegramApi, config: AppConfig, logger: Logger);
    ingest(update: TelegramUpdate, correlationId: string): Promise<IngestResult>;
}
