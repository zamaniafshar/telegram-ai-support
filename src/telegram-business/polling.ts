import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from 'pino';
import { AppError } from '../utils/errors.js';
import type { TelegramApi } from './client.js';
import { telegramUpdateSchema, type TelegramUpdate } from './types.js';

const MIN_ERROR_DELAY_MS = 2_000;
const MAX_ERROR_DELAY_MS = 15_000;
const CONFLICT_DELAY_MS = 5_000;

export class LongPollingRunner {
  constructor(
    private readonly telegram: TelegramApi,
    private readonly allowedUpdates: string[],
    private readonly handler: (update: TelegramUpdate) => Promise<void>,
    private readonly logger: Logger,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    let offset: number | undefined;
    let consecutiveErrors = 0;

    while (!signal.aborted) {
      try {
        const updates = await this.telegram.getUpdates(offset, this.allowedUpdates, 25);
        consecutiveErrors = 0;

        for (const raw of updates) {
          if (signal.aborted) return;

          let rawUpdateId: number | undefined;
          if (
            typeof raw === 'object' &&
            raw !== null &&
            'update_id' in raw &&
            typeof (raw as { update_id: unknown }).update_id === 'number'
          ) {
            rawUpdateId = (raw as { update_id: number }).update_id;
          }

          try {
            const update = telegramUpdateSchema.parse(raw);
            offset = update.update_id + 1;
            await this.handler(update);
          } catch (itemError) {
            if (signal.aborted) return;
            if (rawUpdateId !== undefined) {
              offset = Math.max(offset ?? 0, rawUpdateId + 1);
            }
            this.logger.error({ err: itemError, rawUpdateId }, 'failed to parse or process update');
          }
        }
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;

        consecutiveErrors += 1;
        const isConflict =
          (error instanceof AppError && error.statusCode === 409) ||
          (error instanceof Error &&
            /conflict|409|webhook.*active|terminated by other getUpdates/i.test(error.message));

        const backoffMs = isConflict
          ? CONFLICT_DELAY_MS
          : Math.min(
              MAX_ERROR_DELAY_MS,
              MIN_ERROR_DELAY_MS * Math.pow(1.5, Math.min(consecutiveErrors - 1, 6)),
            );

        this.logger.error(
          {
            err: error,
            isConflict,
            consecutiveErrors,
            backoffMs,
          },
          isConflict
            ? 'long polling conflict detected: check for duplicate bot instances or active webhooks'
            : 'long polling cycle failed, backing off before retry',
        );

        await delay(backoffMs, undefined, { signal }).catch(() => undefined);
      }
    }
  }
}

