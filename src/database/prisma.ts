import { PrismaClient, type Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { isInsideSystemLogger } from '../observability/system-logger.js';

export function createPrismaClient(config?: AppConfig, logger?: Logger): PrismaClient {
  const prisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  if (logger && typeof (prisma as unknown as { $on: unknown }).$on === 'function') {
    (prisma as unknown as { $on: (event: string, cb: (e: Prisma.QueryEvent) => void) => void }).$on(
      'query',
      (e: Prisma.QueryEvent) => {
        const isSystemLog = isInsideSystemLogger() || /systemlog/i.test(e.query);
        logger.trace(
          {
            category: 'DATABASE',
            query: e.query,
            params: e.params,
            durationMs: e.duration,
            target: e.target,
            _fromSystemLogger: isSystemLog,
          },
          `db query executed (${e.duration}ms)`,
        );
      },
    );

    (prisma as unknown as { $on: (event: string, cb: (e: Prisma.LogEvent) => void) => void }).$on(
      'error',
      (e: Prisma.LogEvent) => {
        const isSystemLog = isInsideSystemLogger() || /systemlog/i.test(e.message);
        logger.error(
          {
            category: 'DATABASE',
            target: e.target,
            message: e.message,
            _fromSystemLogger: isSystemLog,
          },
          'database error',
        );
      },
    );

    (prisma as unknown as { $on: (event: string, cb: (e: Prisma.LogEvent) => void) => void }).$on(
      'warn',
      (e: Prisma.LogEvent) => {
        const isSystemLog = isInsideSystemLogger() || /systemlog/i.test(e.message);
        logger.warn(
          {
            category: 'DATABASE',
            target: e.target,
            message: e.message,
            _fromSystemLogger: isSystemLog,
          },
          'database warning',
        );
      },
    );

    (prisma as unknown as { $on: (event: string, cb: (e: Prisma.LogEvent) => void) => void }).$on(
      'info',
      (e: Prisma.LogEvent) => {
        const isSystemLog = isInsideSystemLogger() || /systemlog/i.test(e.message);
        logger.info(
          {
            category: 'DATABASE',
            target: e.target,
            message: e.message,
            _fromSystemLogger: isSystemLog,
          },
          'database info',
        );
      },
    );
  }

  return prisma;
}

export async function databaseHealthy(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
