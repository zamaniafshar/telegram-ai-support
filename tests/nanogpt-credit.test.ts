import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  isNanoGptInsufficientBalanceError,
  NanoGptBalanceClient,
  NanoGptCreditMonitor,
} from '../src/ai/nanogpt-credit.js';
import { silentLogger, testConfig } from './helpers.js';

describe('NanoGPT credit monitoring', () => {
  it('reads and preserves the exact USD balance from the official endpoint', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ usd_balance: '2.12345678' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const config = testConfig();

    const balance = await new NanoGptBalanceClient(config, request).getBalance();

    expect(balance).toEqual({ amountUsd: 2.12345678, displayUsd: '2.12345678' });
    expect(request).toHaveBeenCalledWith(
      'https://nano-gpt.com/api/check-balance',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': config.openai.apiKey }),
      }),
    );
  });

  it('recognizes NanoGPT payment-required errors without confusing rate limits', () => {
    expect(isNanoGptInsufficientBalanceError({ status: 402 })).toBe(true);
    expect(isNanoGptInsufficientBalanceError({ message: 'Insufficient balance' })).toBe(true);
    expect(isNanoGptInsufficientBalanceError({ code: 'webSearch_balance_required' })).toBe(true);
    expect(isNanoGptInsufficientBalanceError({ status: 429, code: 'rate_limit_exceeded' })).toBe(
      false,
    );
  });

  it('rejects malformed balance responses instead of sending an inaccurate amount', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ usd_balance: 'unknown' }), { status: 200 }));

    await expect(new NanoGptBalanceClient(testConfig(), request).getBalance()).rejects.toThrow();
  });

  it('claims the insufficient-credit cooldown before notifying to prevent spam', async () => {
    const state = {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    };
    const prisma = { providerCreditMonitorState: state } as unknown as PrismaClient;
    const balances = {
      getBalance: vi.fn().mockResolvedValue({ amountUsd: 0.25, displayUsd: '0.25000000' }),
    };
    const notifier = {
      nanoGptLowBalance: vi.fn(),
      nanoGptInsufficientBalance: vi.fn().mockResolvedValue(undefined),
    };
    const monitor = new NanoGptCreditMonitor(
      prisma,
      balances,
      notifier,
      testConfig(),
      silentLogger,
    );

    await monitor.providerRequestFailed({ status: 402 });
    await monitor.providerRequestFailed({ status: 402 });

    expect(balances.getBalance).toHaveBeenCalledTimes(1);
    expect(notifier.nanoGptInsufficientBalance).toHaveBeenCalledOnce();
    expect(notifier.nanoGptInsufficientBalance).toHaveBeenCalledWith('0.25000000');
  });
});
