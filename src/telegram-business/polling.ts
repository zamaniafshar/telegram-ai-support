import type { Logger } from 'pino';
import type { TelegramApi } from './client.js';
import { telegramUpdateSchema, type TelegramUpdate } from './types.js';

export class LongPollingRunner {
  constructor(
    private readonly telegram: TelegramApi,
    private readonly allowedUpdates: string[],
    private readonly handler: (update: TelegramUpdate) => Promise<void>,
    private readonly logger: Logger,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    let offset: number | undefined;
    while (!signal.aborted) {
      try {
        const updates = await this.telegram.getUpdates(offset, this.allowedUpdates, 25);
        for (const raw of updates) {
          const update = telegramUpdateSchema.parse(raw);
          offset = update.update_id + 1;
          await this.handler(update);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        this.logger.error({ err: error }, 'long polling cycle failed');
      }
    }
  }
}
