import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../utils/errors.js';
import { telegramUpdateSchema } from './types.js';
const MIN_ERROR_DELAY_MS = 2_000;
const MAX_ERROR_DELAY_MS = 15_000;
const CONFLICT_DELAY_MS = 5_000;
function isAborted(signal) {
    return signal.aborted;
}
export class LongPollingRunner {
    telegram;
    allowedUpdates;
    handler;
    logger;
    systemLogger;
    constructor(telegram, allowedUpdates, handler, logger, systemLogger) {
        this.telegram = telegram;
        this.allowedUpdates = allowedUpdates;
        this.handler = handler;
        this.logger = logger;
        this.systemLogger = systemLogger;
    }
    async run(signal) {
        let offset;
        let consecutiveErrors = 0;
        while (!isAborted(signal)) {
            try {
                const updates = await this.telegram.getUpdates(offset, this.allowedUpdates, 25);
                consecutiveErrors = 0;
                for (const raw of updates) {
                    if (isAborted(signal))
                        return;
                    let rawUpdateId;
                    if (typeof raw === 'object' &&
                        raw !== null &&
                        'update_id' in raw &&
                        typeof raw.update_id === 'number') {
                        rawUpdateId = raw.update_id;
                    }
                    try {
                        const update = telegramUpdateSchema.parse(raw);
                        offset = update.update_id + 1;
                        await this.handler(update);
                    }
                    catch (itemError) {
                        if (isAborted(signal))
                            return;
                        if (rawUpdateId !== undefined) {
                            offset = Math.max(offset ?? 0, rawUpdateId + 1);
                        }
                        this.logger.error({ err: itemError, rawUpdateId }, 'failed to parse or process update');
                    }
                }
            }
            catch (error) {
                if (isAborted(signal) || (error instanceof Error && error.name === 'AbortError'))
                    return;
                consecutiveErrors += 1;
                const isConflict = (error instanceof AppError && error.statusCode === 409) ||
                    (error instanceof Error &&
                        /conflict|409|webhook.*active|terminated by other getUpdates/i.test(error.message));
                const backoffMs = isConflict
                    ? CONFLICT_DELAY_MS
                    : Math.min(MAX_ERROR_DELAY_MS, MIN_ERROR_DELAY_MS * Math.pow(1.5, Math.min(consecutiveErrors - 1, 6)));
                this.logger.error({
                    err: error,
                    isConflict,
                    consecutiveErrors,
                    backoffMs,
                }, isConflict
                    ? 'long polling conflict detected: check for duplicate bot instances or active webhooks'
                    : 'long polling cycle failed, backing off before retry');
                this.systemLogger?.error({
                    category: 'TELEGRAM',
                    message: isConflict ? 'long polling conflict detected' : 'long polling cycle failed',
                    messageFa: isConflict ? 'دو نمونه ربات همزمان اجرا شده' : 'دریافت پیام از تلگرام با خطا مواجه شد',
                    errorCode: isConflict ? 'POLLING_CONFLICT' : 'TELEGRAM_NETWORK_ERROR',
                    metadata: { isConflict, consecutiveErrors, backoffMs, error: error instanceof Error ? error.message : String(error) },
                });
                await delay(backoffMs, undefined, { signal }).catch(() => undefined);
            }
        }
    }
}
//# sourceMappingURL=polling.js.map