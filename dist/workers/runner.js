import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export class WorkerRunner {
    indexing;
    conversations;
    handoffs;
    creditMonitor;
    notifications;
    config;
    logger;
    systemLogger;
    workerId = `worker:${randomUUID()}`;
    constructor(indexing, conversations, handoffs, creditMonitor, notifications, config, logger, systemLogger) {
        this.indexing = indexing;
        this.conversations = conversations;
        this.handoffs = handoffs;
        this.creditMonitor = creditMonitor;
        this.notifications = notifications;
        this.config = config;
        this.logger = logger;
        this.systemLogger = systemLogger;
    }
    async run(signal) {
        this.logger.info({ workerId: this.workerId }, 'durable worker started');
        while (!signal.aborted) {
            try {
                const [indexing, conversations, expired, creditChecked, notifications] = await Promise.all([
                    this.indexing.runBatch(this.workerId),
                    this.conversations.runBatch(this.workerId),
                    this.handoffs.expireBatch(),
                    this.creditMonitor.runDailyCheckIfDue(this.workerId),
                    this.notifications.runBatch(this.workerId),
                ]);
                if (indexing + conversations + expired + notifications > 0) {
                    this.logger.debug({ indexing, conversations, expired, creditChecked, notifications }, 'worker cycle completed');
                    await delay(50, undefined, { signal }).catch(() => undefined);
                    continue;
                }
                await this.systemLogger?.pruneIfDue();
            }
            catch (error) {
                this.logger.error({ err: error, workerId: this.workerId }, 'worker cycle failed');
                this.systemLogger?.error({
                    category: 'WORKER',
                    message: `worker cycle failed: ${error instanceof Error ? error.message : String(error)}`,
                    messageFa: 'پردازش پس‌زمینه با خطا مواجه شد',
                    errorCode: 'WORKER_FAILED',
                    metadata: { workerId: this.workerId, error: error instanceof Error ? error.message : String(error) },
                });
            }
            await delay(this.config.worker.pollIntervalMs, undefined, { signal }).catch(() => undefined);
        }
        this.logger.info({ workerId: this.workerId }, 'durable worker stopped');
    }
}
//# sourceMappingURL=runner.js.map