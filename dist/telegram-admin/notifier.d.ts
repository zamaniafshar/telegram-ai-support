import { NotificationSeverity, type Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { IndexingNotifier } from '../indexing/service.js';
import type { ModeChangeNotifier } from '../handoffs/service.js';
import type { TelegramApi } from '../telegram-business/client.js';
type DatabaseClient = PrismaClient | Prisma.TransactionClient;
export interface NotificationInput {
    dedupeKey: string;
    type: string;
    severity: NotificationSeverity;
    businessAccountId?: string;
    relatedEntityType: string;
    relatedEntityId: string;
    titleFa: string;
    summaryFa: string;
    destinationPath: string;
}
export declare class AdminNotifier implements IndexingNotifier, ModeChangeNotifier {
    private readonly prisma;
    private readonly telegram;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaClient, telegram: TelegramApi, config: AppConfig, logger: Logger);
    enqueue(client: DatabaseClient, input: NotificationInput): Promise<void>;
    handoffActivatedInTransaction(client: Prisma.TransactionClient, input: {
        businessAccountId: string;
        conversationId: string;
        handoffId: string;
    }): Promise<void>;
    additionalCustomerMessage(conversationId: string, _message: string): Promise<void>;
    aiRestored(conversationId: string, automatic: boolean): Promise<void>;
    aiRestoredInTransaction(client: Prisma.TransactionClient, input: {
        businessAccountId: string;
        conversationId: string;
        automatic: boolean;
        eventKey: string;
    }): Promise<void>;
    indexingFailed(input: {
        businessAccountId: string;
        knowledgeId: string;
        title: string;
        errorCode: string;
        knowledgeVersion?: number;
    }): Promise<void>;
    indexingFailedInTransaction(client: Prisma.TransactionClient, input: {
        businessAccountId: string;
        knowledgeId: string;
        title: string;
        errorCode: string;
        knowledgeVersion?: number;
    }): Promise<void>;
    indexingSucceeded(input: {
        businessAccountId: string;
        knowledgeId: string;
        title: string;
        chunkCount: number;
        knowledgeVersion?: number;
    }): Promise<void>;
    indexingSucceededInTransaction(client: Prisma.TransactionClient, input: {
        businessAccountId: string;
        knowledgeId: string;
        title: string;
        chunkCount: number;
        knowledgeVersion?: number;
    }): Promise<void>;
    systemAttention(businessAccountId: string, text: string): Promise<void>;
    nanoGptLowBalance(_balanceUsd: string, _thresholdUsd: number): Promise<void>;
    nanoGptInsufficientBalance(_balanceUsd: string): Promise<void>;
    runBatch(workerId: string): Promise<number>;
}
export {};
