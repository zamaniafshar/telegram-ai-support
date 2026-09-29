import { fixHints, runInSystemLogScope, } from './types.js';
export class SystemLogRepository {
    prisma;
    config;
    logger;
    lastPruneAt = 0;
    constructor(prisma, config, logger) {
        this.prisma = prisma;
        this.config = config;
        this.logger = logger;
    }
    async list(params) {
        const page = Math.max(1, params.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
        const where = {};
        const and = [];
        if (params.businessAccountId) {
            and.push({
                OR: [{ businessAccountId: params.businessAccountId }, { businessAccountId: null }],
            });
        }
        if (params.level)
            where['level'] = params.level;
        if (params.category)
            where['category'] = params.category;
        if (params.errorCode)
            where['errorCode'] = params.errorCode;
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
        const finalWhere = { ...where };
        if (and.length)
            finalWhere['AND'] = and;
        return runInSystemLogScope(async () => {
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
    async get(id) {
        return runInSystemLogScope(async () => {
            return this.prisma.systemLog.findUnique({ where: { id } });
        });
    }
    async summary(params) {
        const since = new Date(Date.now() - (params.sinceHours ?? 24) * 60 * 60 * 1000);
        const whereBase = { createdAt: { gte: since } };
        const and = [];
        if (params.businessAccountId) {
            and.push({
                OR: [{ businessAccountId: params.businessAccountId }, { businessAccountId: null }],
            });
        }
        if (and.length)
            whereBase['AND'] = and;
        return runInSystemLogScope(async () => {
            const recent = await this.prisma.systemLog.findMany({
                where: whereBase,
                orderBy: { createdAt: 'desc' },
                take: 500,
            });
            const byLevel = {};
            const byCategory = {};
            const byError = {};
            for (const r of recent) {
                byLevel[r.level] = (byLevel[r.level] ?? 0) + r.count;
                byCategory[r.category] = (byCategory[r.category] ?? 0) + r.count;
                if (r.errorCode) {
                    const cur = byError[r.errorCode] ?? { count: 0, messageFa: r.messageFa };
                    cur.count += r.count;
                    byError[r.errorCode] = cur;
                }
            }
            const topErrors = Object.entries(byError)
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 5)
                .map(([errorCode, data]) => {
                const res = {
                    errorCode,
                    count: data.count,
                    messageFa: data.messageFa,
                };
                const hint = fixHints[errorCode]?.fix;
                if (hint)
                    res.fix = hint;
                return res;
            });
            const recentErrors = recent
                .filter((r) => r.level === 'ERROR' || r.level === 'FATAL')
                .slice(0, 5);
            return { byLevel, byCategory, topErrors, recentErrors };
        });
    }
    async pruneIfDue() {
        const now = Date.now();
        if (now - this.lastPruneAt < 3600000)
            return 0;
        this.lastPruneAt = now;
        const cutoff = new Date(now - this.config.systemLog.retentionDays * 24 * 60 * 60 * 1000);
        return runInSystemLogScope(async () => {
            try {
                const res = await this.prisma.systemLog.deleteMany({
                    where: { createdAt: { lt: cutoff } },
                });
                if (res.count > 0 && this.logger) {
                    this.logger.info({ _fromSystemLogger: true, pruned: res.count }, 'systemLog retention pruned');
                }
                return res.count;
            }
            catch {
                return 0;
            }
        });
    }
}
//# sourceMappingURL=system-log-repository.js.map