import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { IndexingService } from '../indexing/service.js';
import type { ConversationProcessor } from '../conversations/processor.js';
import type { HandoffService } from '../handoffs/service.js';
import type { NanoGptCreditMonitor } from '../ai/nanogpt-credit.js';
import type { AdminNotifier } from '../telegram-admin/notifier.js';
export declare class WorkerRunner {
    private readonly indexing;
    private readonly conversations;
    private readonly handoffs;
    private readonly creditMonitor;
    private readonly notifications;
    private readonly config;
    private readonly logger;
    readonly workerId: string;
    constructor(indexing: IndexingService, conversations: ConversationProcessor, handoffs: HandoffService, creditMonitor: NanoGptCreditMonitor, notifications: AdminNotifier, config: AppConfig, logger: Logger);
    run(signal: AbortSignal): Promise<void>;
}
