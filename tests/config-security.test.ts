import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { validWebhookSecret } from '../src/security/webhook-secret.js';
import { telegramId } from '../src/utils/ids.js';
import { testConfig } from './helpers.js';

describe('configuration and security boundaries', () => {
  it('loads valid strict configuration and preserves Telegram IDs as bigint', () => {
    const config = testConfig();
    expect(config.telegram.ownerId).toBe(9007199254740991n);
    expect(config.telegram.businessWebhookSecret).not.toBe(config.telegram.adminWebhookSecret);
    expect(config.openai.baseUrl).toBe('https://nano-gpt.com/api/v1');
    expect(config.handoff.customerMessageEnabled).toBe(false);
  });

  it('can explicitly restore the handoff customer message', () => {
    expect(
      testConfig({ HANDOFF_CUSTOMER_MESSAGE_ENABLED: 'true' }).handoff.customerMessageEnabled,
    ).toBe(true);
  });

  it('rejects polling in production', () => {
    expect(() => testConfig({ NODE_ENV: 'production', TELEGRAM_TRANSPORT: 'polling' })).toThrow(
      /Production requires/,
    );
  });

  it('rejects reused webhook secrets', () => {
    const source = {
      NODE_ENV: 'test',
      PUBLIC_BASE_URL: 'https://example.test',
      DATABASE_URL: 'mysql://u:p@localhost:3306/x',
      TELEGRAM_BUSINESS_BOT_TOKEN: '123456:business',
      TELEGRAM_ADMIN_BOT_TOKEN: '123456:admin',
      TELEGRAM_BUSINESS_WEBHOOK_SECRET: 'same-secret-1234567890123456789012',
      TELEGRAM_ADMIN_WEBHOOK_SECRET: 'same-secret-1234567890123456789012',
      TELEGRAM_OWNER_ID: '1',
      OPENAI_API_KEY: 'openai-test-key',
      OPENAI_BASE_URL: 'https://nano-gpt.com/api/v1',
      OPENAI_CHAT_MODEL: 'model',
      OPENAI_EMBEDDING_MODEL: 'embedding',
      QDRANT_URL: 'https://qdrant.test',
    };
    expect(() => loadConfig(source)).toThrow(/secrets must be different/);
  });

  it('compares webhook secrets exactly', () => {
    expect(validWebhookSecret('a'.repeat(32), 'a'.repeat(32))).toBe(true);
    expect(validWebhookSecret('b'.repeat(32), 'a'.repeat(32))).toBe(false);
    expect(validWebhookSecret(undefined, 'a'.repeat(32))).toBe(false);
  });

  it('refuses unsafe numeric Telegram identifiers', () => {
    expect(() => telegramId(Number.MAX_SAFE_INTEGER + 1)).toThrow(/Unsafe numeric Telegram ID/);
    expect(telegramId('9223372036854775807')).toBe(9223372036854775807n);
  });
});
