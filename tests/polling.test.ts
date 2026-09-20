import { describe, expect, it, vi } from 'vitest';
import { LongPollingRunner } from '../src/telegram-business/polling.js';
import { AppError } from '../src/utils/errors.js';
import type { TelegramApi } from '../src/telegram-business/client.js';
import { silentLogger } from './helpers.js';

describe('LongPollingRunner', () => {
  it('advances offset even when a raw update fails schema parsing', async () => {
    const abortController = new AbortController();
    const mockTelegram: Partial<TelegramApi> = {
      getUpdates: vi
        .fn()
        .mockResolvedValueOnce([
          // Malformed update (business_message must be an object if present)
          { update_id: 101, business_message: 'invalid_should_be_object' },
          // Valid update
          {
            update_id: 102,
            business_message: {
              message_id: 50,
              date: 1700000000,
              chat: { id: 12345, type: 'private' },
              text: 'hello',
              business_connection_id: 'conn-1',
            },
          },
        ])
        .mockImplementation(async () => {
          abortController.abort();
          return [];
        }),
    };

    const handled: unknown[] = [];
    const runner = new LongPollingRunner(
      mockTelegram as TelegramApi,
      ['business_message'],
      async (update) => {
        handled.push(update);
      },
      silentLogger,
    );

    await runner.run(abortController.signal);

    expect(handled).toHaveLength(1);
    // On the second call to getUpdates, offset must have advanced past both 101 and 102
    expect(mockTelegram.getUpdates).toHaveBeenNthCalledWith(2, 103, ['business_message'], 25);
  });

  it('backs off on errors without infinite tight loop and aborts cleanly', async () => {
    const abortController = new AbortController();
    let callCount = 0;

    const mockTelegram: Partial<TelegramApi> = {
      getUpdates: vi.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount >= 2) {
          abortController.abort();
        }
        throw new Error('Telegram network error');
      }),
    };

    const runner = new LongPollingRunner(
      mockTelegram as TelegramApi,
      ['business_message'],
      async () => undefined,
      silentLogger,
    );

    const start = Date.now();
    await runner.run(abortController.signal);
    const elapsed = Date.now() - start;

    expect(callCount).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(1500);
  });

  it('detects 409 conflict and waits before retrying', async () => {
    const abortController = new AbortController();
    let callCount = 0;

    const mockTelegram: Partial<TelegramApi> = {
      getUpdates: vi.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount >= 2) {
          abortController.abort();
        }
        throw new AppError(
          'Conflict: terminated by other getUpdates request',
          'TELEGRAM_API_409',
          409,
        );
      }),
    };

    const runner = new LongPollingRunner(
      mockTelegram as TelegramApi,
      ['business_message'],
      async () => undefined,
      silentLogger,
    );

    const start = Date.now();
    await runner.run(abortController.signal);
    const elapsed = Date.now() - start;

    expect(callCount).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(4000);
  }, 12_000);
});
