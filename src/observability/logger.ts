import pino, { type Logger } from 'pino';
import type { AppConfig } from '../config/env.js';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.x-telegram-bot-api-secret-token',
  'config.openai.apiKey',
  'config.telegram.businessBotToken',
  'config.telegram.adminBotToken',
  'config.qdrant.apiKey',
  '*.apiKey',
  '*.token',
];

export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.log.level,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    base: { service: 'telegram-ai-support', env: config.nodeEnv },
    serializers: {
      err: pino.stdSerializers.err,
      customerText: (value: unknown): string =>
        config.log.personalData ? String(value) : '[REDACTED_MESSAGE]',
    },
  });
}
