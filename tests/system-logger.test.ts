import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient, SystemLogLevel, SystemLogCategory } from '@prisma/client';
import { SystemLogger } from '../src/observability/system-logger.js';
import { createLogger } from '../src/observability/logger.js';
import { silentLogger, testConfig } from './helpers.js';

interface LogItem {
  id: string;
  businessAccountId: string | null;
  level: SystemLogLevel;
  category: SystemLogCategory;
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

describe('SystemLogger', () => {
  it('logs errors and queries them with filters and pagination', async () => {
    const logs: LogItem[] = [];
    const mockPrisma = {
      systemLog: {
        create: vi
          .fn()
          .mockImplementation((args: { data: Omit<LogItem, 'createdAt' | 'updatedAt'> }) => {
            const item: LogItem = { ...args.data, createdAt: new Date(), updatedAt: new Date() };
            logs.push(item);
            return Promise.resolve(item);
          }),
        update: vi
          .fn()
          .mockImplementation(
            (args: {
              where: { id: string };
              data: { count?: { increment: number }; updatedAt?: Date };
            }) => {
              const item = logs.find((l) => l.id === args.where.id);
              if (item) {
                item.count += args.data.count?.increment ?? 1;
                item.updatedAt = args.data.updatedAt ?? new Date();
              }
              return Promise.resolve(item);
            },
          ),
        findMany: vi
          .fn()
          .mockImplementation(
            (args: {
              where?: { level?: SystemLogLevel; category?: SystemLogCategory };
              skip?: number;
              take?: number;
            }) => {
              let filtered = [...logs];
              if (args.where?.level) {
                filtered = filtered.filter((l) => l.level === args.where?.level);
              }
              if (args.where?.category) {
                filtered = filtered.filter((l) => l.category === args.where?.category);
              }
              const skip = args.skip ?? 0;
              const take = args.take ?? 20;
              return Promise.resolve(filtered.slice(skip, skip + take));
            },
          ),
        count: vi.fn().mockImplementation(() => Promise.resolve(logs.length)),
        findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
          return Promise.resolve(logs.find((l) => l.id === args.where.id) ?? null);
        }),
      },
    } as unknown as PrismaClient;

    const config = testConfig({
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'warn',
      SYSTEM_LOG_DEDUP_MS: '5000',
    });

    const logger = new SystemLogger(mockPrisma, silentLogger, config);

    await logger.log({
      level: 'ERROR',
      category: 'TELEGRAM',
      message: 'Network timeout to api.telegram.org',
      messageFa: 'خطای ارتباط با تلگرام',
      errorCode: 'TELEGRAM_NETWORK_ERROR',
      businessAccountId: 'biz-1',
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('ERROR');
    expect(logs[0]?.category).toBe('TELEGRAM');

    const result = await logger.list({
      businessAccountId: 'biz-1',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.page).toBe(1);
  });

  it('captures operational Pino logs when SYSTEM_LOG_DB_LEVEL=trace', async () => {
    const logs: LogItem[] = [];
    const mockPrisma = {
      systemLog: {
        create: vi
          .fn()
          .mockImplementation((args: { data: Omit<LogItem, 'createdAt' | 'updatedAt'> }) => {
            const item: LogItem = { ...args.data, createdAt: new Date(), updatedAt: new Date() };
            logs.push(item);
            return Promise.resolve(item);
          }),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue(logs),
        count: vi.fn().mockResolvedValue(logs.length),
      },
    } as unknown as PrismaClient;

    const config = testConfig({
      LOG_LEVEL: 'info',
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'trace',
      SYSTEM_LOG_DEDUP_MS: '300000',
    });

    const pinoLogger = createLogger(config);
    const systemLogger = new SystemLogger(mockPrisma, pinoLogger, config);
    systemLogger.attachToLogger(pinoLogger);

    pinoLogger.trace('trace step');
    pinoLogger.debug('debug step');
    pinoLogger.info({ category: 'WORKER' }, 'worker job started');
    pinoLogger.info(
      {
        reqId: 'req-abc',
        req: {
          method: 'GET',
          url: '/api/v1/businesses/3e9e9f2b-e044-5799-8140-d124c06650a8/system-logs?page=1',
        },
        res: { statusCode: 200 },
        responseTime: 12.4,
      },
      'request completed',
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(logs.map((l) => l.level)).toEqual(['TRACE', 'DEBUG', 'INFO', 'INFO']);

    const httpLog = logs.find((l) => l.category === 'HTTP');
    expect(httpLog).toBeDefined();
    expect(httpLog?.businessAccountId).toBe('3e9e9f2b-e044-5799-8140-d124c06650a8');
    expect(httpLog?.correlationId).toBe('req-abc');
    expect(httpLog?.message).toContain(
      'GET /api/v1/businesses/3e9e9f2b-e044-5799-8140-d124c06650a8/system-logs?page=1 -> 200',
    );
  });

  it('does not collapse normal sequential INFO or TRACE logs despite dedup window', async () => {
    const logs: LogItem[] = [];
    const mockPrisma = {
      systemLog: {
        create: vi
          .fn()
          .mockImplementation((args: { data: Omit<LogItem, 'createdAt' | 'updatedAt'> }) => {
            const item: LogItem = { ...args.data, createdAt: new Date(), updatedAt: new Date() };
            logs.push(item);
            return Promise.resolve(item);
          }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    const config = testConfig({
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'trace',
      SYSTEM_LOG_DEDUP_MS: '300000',
    });

    const pinoLogger = createLogger(config);
    const systemLogger = new SystemLogger(mockPrisma, pinoLogger, config);
    systemLogger.attachToLogger(pinoLogger);

    pinoLogger.info('repeating info message');
    pinoLogger.info('repeating info message');

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(logs).toHaveLength(2);
  });
});
