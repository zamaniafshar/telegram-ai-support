import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
export type SystemLogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export type SystemLogCategory = 'WEBHOOK' | 'TELEGRAM' | 'AI' | 'RETRIEVAL' | 'INDEXING' | 'QDRANT' | 'WORKER' | 'HANDOFF' | 'AUTH' | 'SYSTEM' | 'CREDIT' | 'DATABASE' | 'HTTP';
export interface SystemLogInput {
    level: SystemLogLevel;
    category: SystemLogCategory;
    message: string;
    messageFa: string;
    businessAccountId?: string | null;
    errorCode?: string | null;
    correlationId?: string | null;
    fingerprint?: string | null;
    metadata?: Record<string, unknown> | null;
}
export declare const fixHints: Record<string, {
    fa: string;
    fix: string;
}>;
export declare class SystemLogger {
    private readonly prisma;
    private readonly pino;
    private readonly config;
    private dedup;
    private lastPruneAt;
    constructor(prisma: PrismaClient, pino: Logger, config: AppConfig);
    private shouldPersist;
    private pinoWrite;
    log(input: SystemLogInput): Promise<void>;
    trace(input: Omit<SystemLogInput, 'level'>): void;
    debug(input: Omit<SystemLogInput, 'level'>): void;
    info(input: Omit<SystemLogInput, 'level'>): void;
    warn(input: Omit<SystemLogInput, 'level'>): void;
    error(input: Omit<SystemLogInput, 'level'>): void;
    fatal(input: Omit<SystemLogInput, 'level'>): void;
    pruneIfDue(): Promise<number>;
    list(params: {
        businessAccountId?: string | null;
        level?: SystemLogLevel | null;
        category?: SystemLogCategory | null;
        errorCode?: string | null;
        search?: string | null;
        from?: Date | null;
        to?: Date | null;
        page?: number;
        pageSize?: number;
    }): Promise<{
        items: unknown[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
    }>;
    get(id: string): Promise<unknown | null>;
    summary(params: {
        businessAccountId?: string | null;
        sinceHours?: number;
    }): Promise<{
        byLevel: Record<string, number>;
        byCategory: Record<string, number>;
        topErrors: {
            errorCode: string;
            count: number;
            messageFa: string;
            fix?: string | undefined;
        }[];
        recentErrors: unknown[];
    }>;
}
