import type { Logger } from 'pino';
import type { TelegramApi } from './client.js';
import { type TelegramUpdate } from './types.js';
export declare class LongPollingRunner {
    private readonly telegram;
    private readonly allowedUpdates;
    private readonly handler;
    private readonly logger;
    constructor(telegram: TelegramApi, allowedUpdates: string[], handler: (update: TelegramUpdate) => Promise<void>, logger: Logger);
    run(signal: AbortSignal): Promise<void>;
}
