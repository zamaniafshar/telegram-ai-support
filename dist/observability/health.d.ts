import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import type { VectorStore } from '../retrieval/qdrant.js';
import type { TelegramApi } from '../telegram-business/client.js';
export interface ReadinessReport {
    ready: boolean;
    checks: {
        process: boolean;
        configuration: boolean;
        mysql: boolean;
        qdrant: boolean;
        businessWebhook: boolean;
        adminWebhook: boolean;
    };
}
export declare class HealthService {
    #private;
    private readonly prisma;
    private readonly vectors;
    private readonly businessTelegram;
    private readonly adminTelegram;
    private readonly config;
    constructor(prisma: PrismaClient, vectors: VectorStore, businessTelegram: TelegramApi, adminTelegram: TelegramApi, config: AppConfig);
    readiness(): Promise<ReadinessReport>;
    summary(): Promise<string>;
}
