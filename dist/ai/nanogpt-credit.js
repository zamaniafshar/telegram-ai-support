import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { millisecondsFrom } from '../utils/time.js';
const STATE_ID = 'nanogpt';
const MONITOR_LEASE_MS = 2 * 60 * 1_000;
const FAILED_CHECK_RETRY_MS = 15 * 60 * 1_000;
const balanceResponseSchema = z.object({
    usd_balance: z.string().regex(/^\d+(?:\.\d+)?$/),
});
export class NanoGptBalanceClient {
    config;
    request;
    constructor(config, request = fetch) {
        this.config = config;
        this.request = request;
    }
    async getBalance() {
        const response = await this.request(this.config.nanoGptCredit.balanceUrl, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'x-api-key': this.config.openai.apiKey,
            },
            signal: AbortSignal.timeout(this.config.openai.timeoutMs),
        });
        if (!response.ok) {
            throw new Error(`NanoGPT balance check failed with HTTP ${response.status}`);
        }
        const parsed = balanceResponseSchema.parse(await response.json());
        const amountUsd = Number(parsed.usd_balance);
        if (!Number.isFinite(amountUsd))
            throw new Error('NanoGPT returned an invalid USD balance');
        return { amountUsd, displayUsd: parsed.usd_balance };
    }
}
export function isNanoGptInsufficientBalanceError(error) {
    if (typeof error !== 'object' || error === null)
        return false;
    const candidate = error;
    if (candidate['status'] === 402)
        return true;
    const text = [candidate['message'], candidate['code'], candidate['type']]
        .filter((value) => typeof value === 'string')
        .join(' ');
    return /insufficient[_ -]?(?:balance|credit|quota)|balance[_ -]required/i.test(text);
}
export class NanoGptCreditMonitor {
    prisma;
    balances;
    notifier;
    config;
    logger;
    constructor(prisma, balances, notifier, config, logger) {
        this.prisma = prisma;
        this.balances = balances;
        this.notifier = notifier;
        this.config = config;
        this.logger = logger;
    }
    async runDailyCheckIfDue(workerId) {
        await this.#ensureState();
        const now = new Date();
        const claimed = await this.prisma.providerCreditMonitorState.updateMany({
            where: {
                id: STATE_ID,
                nextCheckAt: { lte: now },
                OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
            },
            data: {
                leaseOwner: workerId,
                leaseExpiresAt: millisecondsFrom(now, MONITOR_LEASE_MS),
            },
        });
        if (claimed.count !== 1)
            return false;
        try {
            const balance = await this.balances.getBalance();
            const isLow = balance.amountUsd < this.config.nanoGptCredit.lowBalanceUsd;
            if (isLow) {
                await this.notifier.nanoGptLowBalance(balance.displayUsd, this.config.nanoGptCredit.lowBalanceUsd);
            }
            await this.prisma.providerCreditMonitorState.updateMany({
                where: { id: STATE_ID, leaseOwner: workerId },
                data: {
                    lastCheckedAt: now,
                    lastBalanceUsd: new Prisma.Decimal(balance.displayUsd),
                    ...(isLow ? { lastLowBalanceAlertAt: now } : {}),
                    nextCheckAt: millisecondsFrom(now, this.config.nanoGptCredit.checkIntervalHours * 60 * 60 * 1_000),
                    leaseOwner: null,
                    leaseExpiresAt: null,
                },
            });
            return true;
        }
        catch (error) {
            await this.prisma.providerCreditMonitorState.updateMany({
                where: { id: STATE_ID, leaseOwner: workerId },
                data: {
                    nextCheckAt: millisecondsFrom(now, FAILED_CHECK_RETRY_MS),
                    leaseOwner: null,
                    leaseExpiresAt: null,
                },
            });
            throw error;
        }
    }
    async providerRequestFailed(error) {
        if (!isNanoGptInsufficientBalanceError(error))
            return;
        const now = new Date();
        try {
            await this.#ensureState();
            const cutoff = millisecondsFrom(now, -this.config.nanoGptCredit.insufficientAlertCooldownHours * 60 * 60 * 1_000);
            const claimed = await this.prisma.providerCreditMonitorState.updateMany({
                where: {
                    id: STATE_ID,
                    OR: [{ lastInsufficientAlertAt: null }, { lastInsufficientAlertAt: { lt: cutoff } }],
                },
                data: { lastInsufficientAlertAt: now },
            });
            if (claimed.count !== 1)
                return;
            const balance = await this.balances.getBalance();
            await this.notifier.nanoGptInsufficientBalance(balance.displayUsd);
            await this.prisma.providerCreditMonitorState.update({
                where: { id: STATE_ID },
                data: {
                    lastCheckedAt: now,
                    lastBalanceUsd: new Prisma.Decimal(balance.displayUsd),
                },
            });
        }
        catch (reportingError) {
            const retryAt = millisecondsFrom(now, FAILED_CHECK_RETRY_MS);
            const retryMarker = millisecondsFrom(retryAt, -this.config.nanoGptCredit.insufficientAlertCooldownHours * 60 * 60 * 1_000);
            await this.prisma.providerCreditMonitorState
                .updateMany({
                where: { id: STATE_ID, lastInsufficientAlertAt: now },
                data: { lastInsufficientAlertAt: retryMarker },
            })
                .catch(() => undefined);
            this.logger.error({ err: reportingError }, 'NanoGPT insufficient-balance alert could not be delivered');
        }
    }
    async #ensureState() {
        await this.prisma.providerCreditMonitorState.upsert({
            where: { id: STATE_ID },
            create: { id: STATE_ID },
            update: {},
        });
    }
}
//# sourceMappingURL=nanogpt-credit.js.map