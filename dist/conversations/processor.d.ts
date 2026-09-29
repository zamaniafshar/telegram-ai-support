import { type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { type GroundedAnswerer } from '../ai/openai.js';
import type { RetrievalService } from '../retrieval/service.js';
import type { HandoffService } from '../handoffs/service.js';
import type { BusinessMessenger } from '../telegram-business/messenger.js';
import type { AdminNotifier } from '../telegram-admin/notifier.js';
import type { AiAvailabilityService } from '../ai/availability.js';
export declare class ConversationProcessor {
    #private;
    private readonly prisma;
    private readonly retrieval;
    private readonly answerer;
    private readonly handoffs;
    private readonly messenger;
    private readonly notifier;
    private readonly availability;
    private readonly config;
    private readonly logger;
    private lastRetentionRunAt;
    constructor(prisma: PrismaClient, retrieval: RetrievalService, answerer: GroundedAnswerer, handoffs: HandoffService, messenger: BusinessMessenger, notifier: AdminNotifier, availability: AiAvailabilityService, config: AppConfig, logger: Logger);
    runBatch(workerId: string): Promise<number>;
}
