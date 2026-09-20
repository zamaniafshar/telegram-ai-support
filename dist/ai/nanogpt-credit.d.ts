import { type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
export interface AiProviderFailureReporter {
    providerRequestFailed(error: unknown): Promise<void>;
}
export interface NanoGptBalance {
    amountUsd: number;
    displayUsd: string;
}
export interface NanoGptBalanceReader {
    getBalance(): Promise<NanoGptBalance>;
}
export interface NanoGptCreditNotifier {
    nanoGptLowBalance(balanceUsd: string, thresholdUsd: number): Promise<void>;
    nanoGptInsufficientBalance(balanceUsd: string): Promise<void>;
}
export declare class NanoGptBalanceClient {
    private readonly config;
    private readonly request;
    constructor(config: AppConfig, request?: typeof fetch);
    getBalance(): Promise<NanoGptBalance>;
}
export declare function isNanoGptInsufficientBalanceError(error: unknown): boolean;
export declare class NanoGptCreditMonitor implements AiProviderFailureReporter {
    #private;
    private readonly prisma;
    private readonly balances;
    private readonly notifier;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaClient, balances: NanoGptBalanceReader, notifier: NanoGptCreditNotifier, config: AppConfig, logger: Logger);
    runDailyCheckIfDue(workerId: string): Promise<boolean>;
    providerRequestFailed(error: unknown): Promise<void>;
}
