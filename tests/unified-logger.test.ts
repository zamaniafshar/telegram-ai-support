import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createLogger, type LogRecord } from '../src/observability/logger.js';
import { SystemLogRepository } from '../src/observability/system-log-repository.js';
import { testConfig } from './helpers.js';

interface LogItem {
  id: string;
  businessAccountId: string | null;
  level: string;
  category: string;
  message: string;
  messageFa: string;
  errorCode: string | null;
  correlationId: string | null;
  fingerprint: string;
  count: number;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

describe('Unified Logger System (Single Source of Truth)', () => {
  it('unifies terminal and MySQL persistence in a single call without duplicate code', async () => {
    const persisted: LogItem[] = [];
    const mockPrisma = {
      systemLog: {
        create: vi
          .fn()
          .mockImplementation((args: { data: Omit<LogItem, 'createdAt' | 'updatedAt'> }) => {
            const item: LogItem = { ...args.data, createdAt: new Date(), updatedAt: new Date() };
            persisted.push(item);
            return Promise.resolve(item);
          }),
      },
    } as unknown as PrismaClient;

    const config = testConfig({
      LOG_LEVEL: 'info',
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'warn',
    });

    const terminalLogs: LogRecord[] = [];
    const logger = createLogger(config, mockPrisma);
    logger.attachSink?.((rec) => terminalLogs.push(rec));

    // Single unified call
    logger.error(
      {
        category: 'AI',
        messageFa: 'خطای هوش مصنوعی',
        errorCode: 'OPENAI_TIMEOUT',
        conversationId: 'conv-123',
        businessAccountId: 'biz-999',
      },
      'OpenAI request timed out after 30s',
    );

    await logger.flushDb?.();

    // 1. Emitted to terminal
    expect(terminalLogs).toHaveLength(1);
    expect(terminalLogs[0]?.['msg']).toBe('OpenAI request timed out after 30s');
    expect(terminalLogs[0]?.['category']).toBe('AI');
    expect(terminalLogs[0]?.['errorCode']).toBe('OPENAI_TIMEOUT');

    // 2. Persisted to MySQL
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.level).toBe('ERROR');
    expect(persisted[0]?.category).toBe('AI');
    expect(persisted[0]?.message).toBe('OpenAI request timed out after 30s');
    expect(persisted[0]?.messageFa).toBe('خطای هوش مصنوعی');
    expect(persisted[0]?.errorCode).toBe('OPENAI_TIMEOUT');
    expect(persisted[0]?.businessAccountId).toBe('biz-999');
    expect((persisted[0]?.metadata as Record<string, unknown>)['conversationId']).toBe('conv-123');
  });

  it('respects DB level threshold and filters lower severity logs from database while keeping them in terminal', async () => {
    const persisted: LogItem[] = [];
    const mockPrisma = {
      systemLog: {
        create: vi
          .fn()
          .mockImplementation((args: { data: Omit<LogItem, 'createdAt' | 'updatedAt'> }) => {
            const item: LogItem = { ...args.data, createdAt: new Date(), updatedAt: new Date() };
            persisted.push(item);
            return Promise.resolve(item);
          }),
      },
    } as unknown as PrismaClient;

    const config = testConfig({
      LOG_LEVEL: 'debug',
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'error', // Only ERROR and FATAL go to MySQL
    });

    const terminalLogs: LogRecord[] = [];
    const logger = createLogger(config, mockPrisma);
    logger.attachSink?.((rec) => terminalLogs.push(rec));

    // Error should appear in MySQL, while info/warn are filtered by dbLevel
    logger.error({ category: 'TELEGRAM', errorCode: 'TELEGRAM_API_429' }, 'rate limit reached');

    await logger.flushDb?.();

    // Sinks on dbStream only receive logs meeting the dbLevel threshold
    expect(terminalLogs).toHaveLength(1);
    expect(terminalLogs[0]?.['msg']).toBe('rate limit reached');

    // MySQL only receives logs meeting the dbLevel threshold
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.level).toBe('ERROR');
    expect(persisted[0]?.message).toBe('rate limit reached');
  });

  it('safely serializes BigInt, Error objects, and circular structures', async () => {
    const persisted: LogItem[] = [];
    const mockPrisma = {
      systemLog: {
        create: vi
          .fn()
          .mockImplementation((args: { data: Omit<LogItem, 'createdAt' | 'updatedAt'> }) => {
            const item: LogItem = { ...args.data, createdAt: new Date(), updatedAt: new Date() };
            persisted.push(item);
            return Promise.resolve(item);
          }),
      },
    } as unknown as PrismaClient;

    const config = testConfig({
      LOG_LEVEL: 'error',
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'error',
    });

    const logger = createLogger(config, mockPrisma);

    const circularObj: Record<string, unknown> = { key: 'value' };
    circularObj['self'] = circularObj;

    logger.error(
      {
        category: 'TELEGRAM',
        telegramChatId: 987654321012345678n, // Telegram 64-bit BigInt
        err: new Error('connection reset'),
        payload: circularObj,
      },
      'telegram delivery error',
    );

    await logger.flushDb?.();

    expect(persisted).toHaveLength(1);
    const meta = persisted[0]?.metadata as Record<string, unknown>;
    expect(meta['telegramChatId']).toBe('987654321012345678');
    expect((meta['err'] as Record<string, unknown>)['message']).toBe('connection reset');
    expect((meta['payload'] as Record<string, unknown>)['self']).toBe('[Circular]');
  });

  it('SystemLogRepository queries, filters, and summarizes logs for admin panel', async () => {
    const sampleLogs = [
      {
        id: 'log-1',
        businessAccountId: 'biz-1',
        level: 'ERROR',
        category: 'AI',
        message: 'model unavailable',
        messageFa: 'مدل در دسترس نیست',
        errorCode: 'EXTERNAL_SERVICE_FAILURE',
        correlationId: 'req-1',
        fingerprint: 'fp-1',
        count: 3,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'log-2',
        businessAccountId: 'biz-1',
        level: 'WARN',
        category: 'TELEGRAM',
        message: 'window expired',
        messageFa: 'پنجره منقضی شد',
        errorCode: 'TELEGRAM_REPLY_WINDOW_EXPIRED',
        correlationId: null,
        fingerprint: 'fp-2',
        count: 1,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const mockPrisma = {
      systemLog: {
        findMany: vi.fn().mockResolvedValue(sampleLogs),
        count: vi.fn().mockResolvedValue(sampleLogs.length),
        findUnique: vi
          .fn()
          .mockImplementation((args: { where: { id: string } }) =>
            Promise.resolve(sampleLogs.find((l) => l.id === args.where.id) ?? null),
          ),
      },
    } as unknown as PrismaClient;

    const config = testConfig();
    const repo = new SystemLogRepository(mockPrisma, config);

    // Test list
    const listResult = await repo.list({
      businessAccountId: 'biz-1',
      level: 'ERROR',
      page: 1,
      pageSize: 10,
    });
    expect(listResult.total).toBe(2);
    expect(listResult.items).toHaveLength(2);

    // Test get
    const detail = await repo.get('log-1');
    expect(detail).toEqual(sampleLogs[0]);

    // Test summary
    const summary = await repo.summary({ businessAccountId: 'biz-1', sinceHours: 24 });
    expect(summary.byLevel['ERROR']).toBe(3);
    expect(summary.byLevel['WARN']).toBe(1);
    expect(summary.byCategory['AI']).toBe(3);
    expect(summary.byCategory['TELEGRAM']).toBe(1);
    expect(summary.topErrors[0]?.errorCode).toBe('EXTERNAL_SERVICE_FAILURE');
    expect(summary.topErrors[0]?.count).toBe(3);
  });
});
