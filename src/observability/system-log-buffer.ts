import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { newId } from '../utils/ids.js';
import {
  type SystemLogEntry,
  type SystemLogLevel,
  fpOf,
  safeJsonValue,
  sanitize,
  systemLogStorage,
} from './types.js';

interface PreparedLog {
  id: string;
  businessAccountId: string | null;
  level: SystemLogLevel;
  category: SystemLogEntry['category'];
  message: string;
  messageFa: string;
  errorCode: string | null;
  correlationId: string | null;
  fingerprint: string;
  count: number;
  metadata: unknown;
  dedupKey?: string | undefined;
  shouldDedup: boolean;
}

export class SystemLogBuffer {
  private queue: PreparedLog[] = [];
  private readonly dedup = new Map<string, { id: string; at: number }>();
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  // Circuit breaker state
  private consecutiveFailures = 0;
  private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private lastFailureTime = 0;
  private readonly circuitCooldownMs = 30_000;
  private readonly failureThreshold = 5;
  private readonly maxQueueSize = 5_000;
  private readonly batchSize = 50;
  private readonly flushIntervalMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly logger?: Logger,
  ) {
    this.flushIntervalMs = config.nodeEnv === 'test' ? 10 : 500;
  }

  enqueue(entry: SystemLogEntry): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.splice(0, 100);
      if (this.logger) {
        this.logger.warn(
          { _fromSystemLogger: true, dropped: 100 },
          'SystemLogBuffer queue full, dropped oldest records',
        );
      }
    }

    const message = sanitize(entry.message, 500);
    const messageFa = sanitize(entry.messageFa || entry.message, 500);
    const errorCode = entry.errorCode ? sanitize(entry.errorCode, 100) : null;
    const correlationId = entry.correlationId ? sanitize(entry.correlationId, 64) : null;
    const metadata = entry.metadata ? safeJsonValue(entry.metadata) : null;
    const fp = fpOf({ ...entry, message, fingerprint: entry.fingerprint ?? null });
    const businessAccountId = entry.businessAccountId ?? null;

    const isErrorOrWarn =
      entry.level === 'WARN' || entry.level === 'ERROR' || entry.level === 'FATAL';
    const dedupMs = this.config.systemLog.dedupMs;
    const shouldDedup = isErrorOrWarn && dedupMs > 0 && !correlationId;
    const dedupKey = `${businessAccountId ?? 'global'}:${fp}`;

    // Deduplicate in-memory within pending queue
    if (shouldDedup) {
      const pending = this.queue.find((item) => item.dedupKey === dedupKey);
      if (pending) {
        pending.count += 1;
        pending.metadata = metadata;
        return;
      }
    }

    this.queue.push({
      id: newId(),
      businessAccountId,
      level: entry.level,
      category: entry.category,
      message,
      messageFa,
      errorCode,
      correlationId,
      fingerprint: fp,
      count: 1,
      metadata,
      dedupKey: shouldDedup ? dedupKey : undefined,
      shouldDedup,
    });

    if (this.queue.length >= this.batchSize) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    while (this.isFlushing) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    while (this.queue.length > 0) {
      this.isFlushing = true;
      const batch = this.queue.splice(0, this.batchSize);
      try {
        await this.persistBatch(batch);
      } finally {
        this.isFlushing = false;
      }
    }
  }

  private async persistBatch(batch: PreparedLog[]): Promise<void> {
    // Check circuit breaker
    const now = Date.now();
    if (this.circuitState === 'OPEN') {
      if (now - this.lastFailureTime > this.circuitCooldownMs) {
        this.circuitState = 'HALF_OPEN';
      } else {
        return;
      }
    }

    try {
      await systemLogStorage.run({ isSystemLog: true }, async () => {
        const toCreate: PreparedLog[] = [];
        const dedupMs = this.config.systemLog.dedupMs;

        for (const item of batch) {
          if (item.shouldDedup && item.dedupKey) {
            const existing = this.dedup.get(item.dedupKey);
            if (existing && now - existing.at < dedupMs) {
              try {
                await this.prisma.systemLog.update({
                  where: { id: existing.id },
                  data: {
                    count: { increment: item.count },
                    metadata: item.metadata as never,
                    updatedAt: new Date(),
                  },
                });
                this.dedup.set(item.dedupKey, { id: existing.id, at: now });
                continue;
              } catch {
                // If update fails, fall back to create
              }
            }
          }
          toCreate.push(item);
        }

        if (toCreate.length > 0) {
          const prismaModel = this.prisma.systemLog as unknown as {
            createMany?: (args: { data: unknown[] }) => Promise<{ count: number }>;
            create: (args: { data: unknown }) => Promise<unknown>;
          };

          if (typeof prismaModel.createMany === 'function' && toCreate.length > 1) {
            await prismaModel.createMany({
              data: toCreate.map((item) => ({
                id: item.id,
                businessAccountId: item.businessAccountId,
                level: item.level,
                category: item.category,
                message: item.message,
                messageFa: item.messageFa,
                errorCode: item.errorCode,
                correlationId: item.correlationId,
                fingerprint: item.fingerprint,
                count: item.count,
                metadata: item.metadata as never,
              })),
            });
          } else {
            await Promise.all(
              toCreate.map((item) =>
                prismaModel.create({
                  data: {
                    id: item.id,
                    businessAccountId: item.businessAccountId,
                    level: item.level,
                    category: item.category,
                    message: item.message,
                    messageFa: item.messageFa,
                    errorCode: item.errorCode,
                    correlationId: item.correlationId,
                    fingerprint: item.fingerprint,
                    count: item.count,
                    metadata: item.metadata as never,
                  },
                }),
              ),
            );
          }

          // Update dedup cache
          for (const item of toCreate) {
            if (item.shouldDedup && item.dedupKey) {
              this.dedup.set(item.dedupKey, { id: item.id, at: now });
            }
          }

          // Prune dedup map if too large
          if (this.dedup.size > 2000) {
            const first = this.dedup.keys().next().value;
            if (first) this.dedup.delete(first);
          }
        }
      });

      // Circuit breaker success
      this.consecutiveFailures = 0;
      this.circuitState = 'CLOSED';
    } catch (error) {
      this.consecutiveFailures += 1;
      this.lastFailureTime = Date.now();

      if (this.consecutiveFailures >= this.failureThreshold) {
        this.circuitState = 'OPEN';
        if (this.logger) {
          this.logger.error(
            { _fromSystemLogger: true, err: error, failures: this.consecutiveFailures },
            'SystemLogBuffer circuit breaker tripped OPEN - disabling MySQL logging temporarily',
          );
        }
      } else if (this.logger) {
        this.logger.warn(
          { _fromSystemLogger: true, err: error },
          'SystemLogBuffer batch persist failed, will retry on next batch',
        );
      }
    }
  }
}
