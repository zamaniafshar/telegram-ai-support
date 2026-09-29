import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import {
  type SystemLogLevel,
  type SystemLogCategory,
  fixHints,
  systemLogStorage,
} from './types.js';

export interface ListSystemLogsParams {
  businessAccountId?: string | null;
  level?: SystemLogLevel | null;
  category?: SystemLogCategory | null;
  errorCode?: string | null;
  search?: string | null;
  from?: Date | null;
  to?: Date | null;
  page?: number;
  pageSize?: number;
}

export interface SystemLogListResult {
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SystemLogSummaryResult {
  byLevel: Record<string, number>;
  byCategory: Record<string, number>;
  topErrors: { errorCode: string; count: number; messageFa: string; fix?: string }[];
  recentErrors: unknown[];
}

export class SystemLogRepository {
  private lastPruneAt = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly logger?: Logger,
  ) {}

  async list(params: ListSystemLogsParams): Promise<SystemLogListResult> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];

    if (params.businessAccountId) {
      and.push({
        OR: [{ businessAccountId: params.businessAccountId }, { businessAccountId: null }],
      });
    }
    if (params.level) where['level'] = params.level;
    if (params.category) where['category'] = params.category;
    if (params.errorCode) where['errorCode'] = params.errorCode;
    if (params.from || params.to) {
      where['createdAt'] = {
        ...(params.from ? { gte: params.from } : {}),
        ...(params.to ? { lte: params.to } : {}),
      };
    }
    if (params.search) {
      const s = params.search.trim();
      if (s) {
        and.push({
          OR: [
            { message: { contains: s } },
            { messageFa: { contains: s } },
            { errorCode: { contains: s } },
            { correlationId: { contains: s } },
          ],
        });
      }
    }
    const finalWhere: Record<string, unknown> = { ...where };
    if (and.length) finalWhere['AND'] = and;

    return systemLogStorage.run({ isSystemLog: true }, async () => {
      const [items, total] = await Promise.all([
        this.prisma.systemLog.findMany({
          where: finalWhere,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.systemLog.count({ where: finalWhere }),
      ]);
      return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    });
  }

  async get(id: string): Promise<unknown> {
    return systemLogStorage.run({ isSystemLog: true }, async () => {
      return this.prisma.systemLog.findUnique({ where: { id } });
    });
  }

  async summary(params: {
    businessAccountId?: string | null;
    sinceHours?: number;
  }): Promise<SystemLogSummaryResult> {
    const since = new Date(Date.now() - (params.sinceHours ?? 24) * 60 * 60 * 1000);
    const whereBase: Record<string, unknown> = { createdAt: { gte: since } };
    const and: Record<string, unknown>[] = [];
    if (params.businessAccountId) {
      and.push({
        OR: [{ businessAccountId: params.businessAccountId }, { businessAccountId: null }],
      });
    }
    if (and.length) whereBase['AND'] = and;

    return systemLogStorage.run({ isSystemLog: true }, async () => {
      const recent = await this.prisma.systemLog.findMany({
        where: whereBase,
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      const byLevel: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      const byError: Record<string, { count: number; messageFa: string }> = {};

      for (const r of recent) {
        byLevel[r.level] = (byLevel[r.level] ?? 0) + r.count;
        byCategory[r.category] = (byCategory[r.category] ?? 0) + r.count;
        if (r.errorCode) {
          const cur = byError[r.errorCode] ?? { count: 0, messageFa: r.messageFa };
          cur.count += r.count;
          byError[r.errorCode] = cur;
        }
      }

      const topErrors: { errorCode: string; count: number; messageFa: string; fix?: string }[] =
        Object.entries(byError)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 5)
          .map(([errorCode, data]) => {
            const res: { errorCode: string; count: number; messageFa: string; fix?: string } = {
              errorCode,
              count: data.count,
              messageFa: data.messageFa,
            };
            const hint = fixHints[errorCode]?.fix;
            if (hint) res.fix = hint;
            return res;
          });

      const recentErrors = recent
        .filter((r) => r.level === 'ERROR' || r.level === 'FATAL')
        .slice(0, 5);

      return { byLevel, byCategory, topErrors, recentErrors };
    });
  }

  async pruneIfDue(): Promise<number> {
    const now = Date.now();
    if (now - this.lastPruneAt < 3600000) return 0;
    this.lastPruneAt = now;
    const cutoff = new Date(now - this.config.systemLog.retentionDays * 24 * 60 * 60 * 1000);

    return systemLogStorage.run({ isSystemLog: true }, async () => {
      try {
        const res = await this.prisma.systemLog.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
        if (res.count > 0 && this.logger) {
          this.logger.info(
            { _fromSystemLogger: true, pruned: res.count },
            'systemLog retention pruned',
          );
        }
        return res.count;
      } catch {
        return 0;
      }
    });
  }
}
