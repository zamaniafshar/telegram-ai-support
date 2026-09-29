import { type Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import { type SystemLogEntry } from './types.js';
export type LogRecord = Record<string, unknown>;
export type LogSink = (record: LogRecord) => void;
export interface AppLogger extends Logger {
    attachSink?: ((sink: LogSink) => () => void) | undefined;
    attachDatabase?: ((prisma: PrismaClient) => void) | undefined;
    setDatabase?: ((prisma: PrismaClient) => void) | undefined;
    flushDb?: (() => Promise<void>) | undefined;
    logEvent?: ((entry: SystemLogEntry) => void) | undefined;
}
export declare function recordToSystemLogEntry(record: LogRecord): SystemLogEntry | null;
export declare function createLogger(config: AppConfig, prisma?: PrismaClient): AppLogger;
