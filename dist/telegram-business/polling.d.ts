import type { Logger } from 'pino';
import type { TelegramApi } from './client.js';
import type { SystemLogger } from '../observability/system-logger.js';
import { type TelegramUpdate } from './types.js';
export declare class LongPollingRunner {
    private readonly telegram;
    private readonly allowedUpdates;
    private readonly handler;
    private readonly logger;
    private readonly systemLogger?;
    constructor(telegram: TelegramApi, allowedUpdates: string[], handler: (update: TelegramUpdate) => Promise<void>, logger: Logger, systemLogger?: SystemLogger | undefined);
    run(signal: AbortSignal): Promise<void>;
}
