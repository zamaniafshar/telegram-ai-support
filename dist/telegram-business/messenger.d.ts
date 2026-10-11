import { type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { TelegramApi } from './client.js';
export interface SendAiAnswerOptions {
    isCopyPaste?: boolean;
}
export declare class BusinessMessenger {
    #private;
    private readonly prisma;
    private readonly telegram;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaClient, telegram: TelegramApi, config: AppConfig, logger: Logger);
    sendAiAnswer(conversationId: string, text: string, sourceMessageId: string, options?: SendAiAnswerOptions): Promise<void>;
    whileTyping<T>(conversationId: string, operation: () => Promise<T>): Promise<T>;
    sendHandoffAcknowledgement(conversationId: string, text: string, sourceMessageId: string): Promise<void>;
}
