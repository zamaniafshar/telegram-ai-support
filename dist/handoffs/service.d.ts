import { Prisma, type Admin, type Conversation, type Handoff, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
export interface ModeChangeNotifier {
    aiRestored(conversationId: string, automatic: boolean): Promise<void>;
    handoffActivatedInTransaction?(client: Prisma.TransactionClient, input: {
        businessAccountId: string;
        conversationId: string;
        handoffId: string;
    }): Promise<void>;
    aiRestoredInTransaction?(client: Prisma.TransactionClient, input: {
        businessAccountId: string;
        conversationId: string;
        automatic: boolean;
        eventKey: string;
    }): Promise<void>;
}
export declare class HandoffService {
    private readonly prisma;
    private readonly config;
    private readonly logger;
    private readonly notifier?;
    constructor(prisma: PrismaClient, config: AppConfig, logger: Logger, notifier?: ModeChangeNotifier | undefined);
    activate(conversationId: string, reasonCode: string, reasonDetail?: string, now?: Date): Promise<{
        conversation: Conversation;
        handoff: Handoff;
        created: boolean;
    }>;
    enableAiNow(businessAccountId: string, conversationId: string, admin: Admin, now?: Date): Promise<boolean>;
    extend(businessAccountId: string, conversationId: string, admin: Admin, now?: Date): Promise<Date>;
    acknowledge(businessAccountId: string, conversationId: string, admin: Admin, now?: Date): Promise<void>;
    claim(businessAccountId: string, conversationId: string, admin: Admin, now?: Date): Promise<void>;
    resolve(businessAccountId: string, conversationId: string, admin: Admin, outcome: string, note?: string, now?: Date): Promise<void>;
    expireBatch(now?: Date): Promise<number>;
}
