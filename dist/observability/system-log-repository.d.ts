import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { type SystemLogLevel, type SystemLogCategory } from './types.js';
export interface ListSystemLogsParams {
    businessAccountId?: string | null;
    level?: SystemLogLevel | null;
    category?: SystemLogCategory | null;
    errorCode?: string | null;
    search?: string | null;
    from?: Date | null;
    to?: Date | null;
    page?: number;
    pageSize?: number;
}
export interface SystemLogListResult {
    items: unknown[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}
export interface SystemLogSummaryResult {
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
    topErrors: {
        errorCode: string;
        count: number;
        messageFa: string;
        fix?: string;
    }[];
    recentErrors: unknown[];
}
export declare class SystemLogRepository {
    private readonly prisma;
    private readonly config;
    private readonly logger?;
    private lastPruneAt;
    constructor(prisma: PrismaClient, config: AppConfig, logger?: Logger | undefined);
    list(params: ListSystemLogsParams): Promise<SystemLogListResult>;
    get(id: string): Promise<unknown>;
    summary(params: {
        businessAccountId?: string | null;
        sinceHours?: number;
    }): Promise<SystemLogSummaryResult>;
    pruneIfDue(): Promise<number>;
}
