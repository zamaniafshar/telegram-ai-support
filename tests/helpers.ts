import pino from 'pino';
import { loadConfig } from '../src/config/env.js';

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_BASE_URL: 'https://example.test',
    DATABASE_URL: 'mysql://user:pass@localhost:3306/test',
    TELEGRAM_BUSINESS_BOT_TOKEN: '123456:business-token',
    TELEGRAM_BUSINESS_WEBHOOK_SECRET: 'business-secret-12345678901234567890',
    TELEGRAM_ADMIN_BOT_TOKEN: '123456:admin-token',
    TELEGRAM_ADMIN_WEBHOOK_SECRET: 'admin-secret-12345678901234567890123',
    TELEGRAM_OWNER_ID: '9007199254740991',
    TELEGRAM_INITIAL_ADMIN_IDS: '',
    OPENAI_API_KEY: 'test-openai-api-key',
    OPENAI_BASE_URL: 'https://nano-gpt.com/api/v1',
    OPENAI_CHAT_MODEL: 'test-chat-model',
    OPENAI_EMBEDDING_MODEL: 'test-embedding-model',
    OPENAI_EMBEDDING_DIMENSIONS: '3',
    QDRANT_URL: 'https://qdrant.example.test',
    QDRANT_API_KEY: 'test-qdrant-key',
    QDRANT_COLLECTION: 'test_collection',
    ...overrides,
  });
}

export const silentLogger = pino({ level: 'silent' });
