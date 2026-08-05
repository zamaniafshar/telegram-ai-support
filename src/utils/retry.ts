import { setTimeout as delay } from 'node:timers/promises';
import { isRetryable } from './errors.js';

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  signal?: AbortSignal;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts || !isRetryable(error)) throw error;
      const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
      const jittered = Math.round(exponential * (0.75 + Math.random() * 0.5));
      await delay(jittered, undefined, { signal: options.signal });
    }
  }
  throw lastError;
}
