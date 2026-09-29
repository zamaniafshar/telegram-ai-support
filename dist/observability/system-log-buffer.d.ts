import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { type SystemLogEntry } from './types.js';
export declare class SystemLogBuffer {
    private readonly prisma;
    private readonly config;
    private readonly logger?;
    private queue;
    private readonly dedup;
    private flushTimer;
    private isFlushing;
    private consecutiveFailures;
    private circuitState;
    private lastFailureTime;
    private readonly circuitCooldownMs;
    private readonly failureThreshold;
    private readonly maxQueueSize;
    private readonly batchSize;
    private readonly flushIntervalMs;
    constructor(prisma: PrismaClient, config: AppConfig, logger?: Logger | undefined);
    enqueue(entry: SystemLogEntry): void;
    private scheduleFlush;
    flush(): Promise<void>;
    private persistBatch;
}
