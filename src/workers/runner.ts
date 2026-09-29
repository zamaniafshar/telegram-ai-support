import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { IndexingService } from '../indexing/service.js';
import type { ConversationProcessor } from '../conversations/processor.js';
import type { HandoffService } from '../handoffs/service.js';
import type { NanoGptCreditMonitor } from '../ai/nanogpt-credit.js';
import type { AdminNotifier } from '../telegram-admin/notifier.js';
import type { SystemLogRepository } from '../observability/system-log-repository.js';

export class WorkerRunner {
  readonly workerId = `worker:${randomUUID()}`;

  constructor(
    private readonly indexing: IndexingService,
    private readonly conversations: ConversationProcessor,
    private readonly handoffs: HandoffService,
    private readonly creditMonitor: NanoGptCreditMonitor,
    private readonly notifications: AdminNotifier,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly systemLogRepo?: SystemLogRepository,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
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
          this.logger.debug(
            { indexing, conversations, expired, creditChecked, notifications },
            'worker cycle completed',
          );
          await delay(50, undefined, { signal }).catch(() => undefined);
          continue;
        }
        await this.systemLogRepo?.pruneIfDue();
      } catch (error) {
        this.logger.error(
          {
            err: error,
            workerId: this.workerId,
            category: 'WORKER',
            messageFa: 'پردازش پس‌زمینه با خطا مواجه شد',
            errorCode: 'WORKER_FAILED',
          },
          `worker cycle failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await delay(this.config.worker.pollIntervalMs, undefined, { signal }).catch(() => undefined);
    }
    this.logger.info({ workerId: this.workerId }, 'durable worker stopped');
  }
}
