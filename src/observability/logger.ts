import { Writable } from 'node:stream';
import pino, { type Level, type Logger } from 'pino';
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

export type LogRecord = Record<string, unknown>;
export type LogSink = (record: LogRecord) => void;

export interface AppLogger extends Logger {
  attachSink?(sink: LogSink): () => void;
}

const levelValues: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 999,
};

function getMinLevel(a: string, b: string): Level {
  const valA = levelValues[a] ?? 30;
  const valB = levelValues[b] ?? 40;
  const minVal = Math.min(valA, valB);
  const found = Object.entries(levelValues).find(([, val]) => val === minVal);
  return (found ? found[0] : 'info') as Level;
}

export function createLogger(config: AppConfig): AppLogger {
  const sinks = new Set<LogSink>();

  const dbStream = new Writable({
    write(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ) {
      try {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const record = JSON.parse(text) as LogRecord;
        for (const sink of sinks) {
          try {
            sink(record);
          } catch {
            // Ignore sink errors to avoid failing the logger
          }
        }
      } catch {
        // Ignore JSON parse errors for non-JSON chunks
      }
      callback();
    },
  });

  const streams: { stream: NodeJS.WritableStream; level: Level }[] = [
    { stream: process.stdout, level: config.log.level as Level },
  ];

  if (config.systemLog.enabled && config.systemLog.dbLevel !== 'silent') {
    streams.push({ stream: dbStream, level: config.systemLog.dbLevel as Level });
  }

  const rootLevel = config.systemLog.enabled
    ? getMinLevel(config.log.level, config.systemLog.dbLevel)
    : (config.log.level as Level);

  const logger = pino(
    {
      level: rootLevel,
      redact: { paths: redactPaths, censor: '[REDACTED]' },
      base: { service: 'telegram-ai-support', env: config.nodeEnv },
      serializers: {
        err: pino.stdSerializers.err,
        customerText: (value: unknown): string =>
          config.log.personalData || config.log.level === 'trace'
            ? String(value)
            : '[REDACTED_MESSAGE]',
      },
    },
    pino.multistream(streams),
  ) as AppLogger;

  logger.attachSink = (sink: LogSink) => {
    sinks.add(sink);
    return () => sinks.delete(sink);
  };

  return logger;
}
