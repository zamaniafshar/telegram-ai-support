import { type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { TelegramApi } from './client.js';
import type { SystemLogger } from '../observability/system-logger.js';
export declare class BusinessMessenger {
    #private;
    private readonly prisma;
    private readonly telegram;
    private readonly config;
    private readonly logger;
    private readonly systemLogger?;
    constructor(prisma: PrismaClient, telegram: TelegramApi, config: AppConfig, logger: Logger, systemLogger?: SystemLogger | undefined);
    sendAiAnswer(conversationId: string, text: string, sourceMessageId: string): Promise<void>;
    whileTyping<T>(conversationId: string, operation: () => Promise<T>): Promise<T>;
    sendHandoffAcknowledgement(conversationId: string, text: string, sourceMessageId: string): Promise<void>;
}
