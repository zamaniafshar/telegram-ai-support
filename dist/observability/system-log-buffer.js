import { newId } from '../utils/ids.js';
import { fpOf, safeJsonValue, sanitize, systemLogStorage, } from './types.js';
export class SystemLogBuffer {
    prisma;
    config;
    logger;
    queue = [];
    dedup = new Map();
    flushTimer = null;
    isFlushing = false;
    // Circuit breaker state
    consecutiveFailures = 0;
    circuitState = 'CLOSED';
    lastFailureTime = 0;
    circuitCooldownMs = 30_000;
    failureThreshold = 5;
    maxQueueSize = 5_000;
    batchSize = 50;
    flushIntervalMs;
    constructor(prisma, config, logger) {
        this.prisma = prisma;
        this.config = config;
        this.logger = logger;
        this.flushIntervalMs = config.nodeEnv === 'test' ? 10 : 500;
    }
    enqueue(entry) {
        if (this.queue.length >= this.maxQueueSize) {
            this.queue.splice(0, 100);
            if (this.logger) {
                this.logger.warn({ _fromSystemLogger: true, dropped: 100 }, 'SystemLogBuffer queue full, dropped oldest records');
            }
        }
        const message = sanitize(entry.message, 500);
        const messageFa = sanitize(entry.messageFa || entry.message, 500);
        const errorCode = entry.errorCode ? sanitize(entry.errorCode, 100) : null;
        const correlationId = entry.correlationId ? sanitize(entry.correlationId, 64) : null;
        const metadata = entry.metadata ? safeJsonValue(entry.metadata) : null;
        const fp = fpOf({ ...entry, message, fingerprint: entry.fingerprint ?? null });
        const businessAccountId = entry.businessAccountId ?? null;
        const isErrorOrWarn = entry.level === 'WARN' || entry.level === 'ERROR' || entry.level === 'FATAL';
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
        }
        else {
            this.scheduleFlush();
        }
    }
    scheduleFlush() {
        if (this.flushTimer !== null)
            return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
        }, this.flushIntervalMs);
        if (typeof this.flushTimer.unref === 'function') {
            this.flushTimer.unref();
        }
    }
    async flush() {
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
            }
            finally {
                this.isFlushing = false;
            }
        }
    }
    async persistBatch(batch) {
        // Check circuit breaker
        const now = Date.now();
        if (this.circuitState === 'OPEN') {
            if (now - this.lastFailureTime > this.circuitCooldownMs) {
                this.circuitState = 'HALF_OPEN';
            }
            else {
                return;
            }
        }
        try {
            await systemLogStorage.run({ isSystemLog: true }, async () => {
                const toCreate = [];
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
                                        metadata: item.metadata,
                                        updatedAt: new Date(),
                                    },
                                });
                                this.dedup.set(item.dedupKey, { id: existing.id, at: now });
                                continue;
                            }
                            catch {
                                // If update fails, fall back to create
                            }
                        }
                    }
                    toCreate.push(item);
                }
                if (toCreate.length > 0) {
                    const prismaModel = this.prisma.systemLog;
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
                                metadata: item.metadata,
                            })),
                        });
                    }
                    else {
                        await Promise.all(toCreate.map((item) => prismaModel.create({
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
                                metadata: item.metadata,
                            },
                        })));
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
                        if (first)
                            this.dedup.delete(first);
                    }
                }
            });
            // Circuit breaker success
            this.consecutiveFailures = 0;
            this.circuitState = 'CLOSED';
        }
        catch (error) {
            this.consecutiveFailures += 1;
            this.lastFailureTime = Date.now();
            if (this.consecutiveFailures >= this.failureThreshold) {
                this.circuitState = 'OPEN';
                if (this.logger) {
                    this.logger.error({ _fromSystemLogger: true, err: error, failures: this.consecutiveFailures }, 'SystemLogBuffer circuit breaker tripped OPEN - disabling MySQL logging temporarily');
                }
            }
            else if (this.logger) {
                this.logger.warn({ _fromSystemLogger: true, err: error }, 'SystemLogBuffer batch persist failed, will retry on next batch');
            }
        }
    }
}
//# sourceMappingURL=system-log-buffer.js.map