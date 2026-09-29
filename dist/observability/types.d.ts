import { AsyncLocalStorage } from 'node:async_hooks';
export declare const systemLogStorage: AsyncLocalStorage<{
    isSystemLog: boolean;
}>;
export declare function isInsideSystemLogger(): boolean;
export declare function runInSystemLogScope<T>(fn: () => Promise<T> | T): Promise<T>;
export type SystemLogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export type PinoLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
export type SystemLogCategory = 'WEBHOOK' | 'TELEGRAM' | 'AI' | 'RETRIEVAL' | 'INDEXING' | 'QDRANT' | 'WORKER' | 'HANDOFF' | 'AUTH' | 'SYSTEM' | 'CREDIT' | 'DATABASE' | 'HTTP';
export declare const VALID_CATEGORIES: readonly SystemLogCategory[];
export declare const levelSeverity: Record<SystemLogLevel, number>;
export declare const dbLevelSeverity: Record<string, number>;
export interface SystemLogEntry {
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
export type SystemLogInput = SystemLogEntry;
export declare const fixHints: Record<string, {
    fa: string;
    fix: string;
}>;
export declare function sanitize(text: string, max?: number): string;
export declare function fpOf(input: Pick<SystemLogEntry, 'category' | 'level' | 'errorCode' | 'message' | 'fingerprint'>): string;
export declare function safeJsonValue(value: unknown, seen?: WeakSet<WeakKey>): unknown;
