import crypto from 'node:crypto';
import { newId } from '../utils/ids.js';
const levelSeverity = { TRACE: 10, DEBUG: 20, INFO: 30, WARN: 40, ERROR: 50, FATAL: 60 };
const dbLevelSeverity = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 999 };
export const fixHints = {
    TELEGRAM_REPLY_WINDOW_EXPIRED: { fa: 'پنجره 24ساعته تلگرام منقضی شده', fix: 'منتظر پیام جدید مشتری بمانید یا از پنل پیام انسانی ارسال کنید.' },
    TELEGRAM_API_429: { fa: 'تلگرام محدودیت نرخ اعمال کرده', fix: 'چند دقیقه صبر کنید. ربات خودکار تلاش می‌کند.' },
    TELEGRAM_NETWORK_ERROR: { fa: 'ارتباط با تلگرام برقرار نشد', fix: 'api.telegram.org را بررسی کنید.' },
    WEBHOOK_UNAUTHORIZED: { fa: 'توکن وب‌هوک اشتباه است', fix: 'SECRET در .env را با telegram:set-webhooks همگام کنید.' },
    WEBHOOK_INVALID_PAYLOAD: { fa: 'بدنه وب‌هوک نامعتبر', fix: 'نسخه ربات را به‌روز کنید.' },
    BUSINESS_CONNECTION_DISABLED: { fa: 'اتصال تجاری غیرفعال', fix: 'Settings > Telegram Business > Chatbots را چک کنید.' },
    BUSINESS_CANNOT_REPLY: { fa: 'دسترسی پاسخ ندارد', fix: 'can_reply را در Chatbot فعال کنید.' },
    QDRANT_UNHEALTHY: { fa: 'Qdrant در دسترس نیست', fix: 'QDRANT_URL/API_KEY را بررسی کنید.' },
    MYSQL_UNHEALTHY: { fa: 'MySQL در دسترس نیست', fix: 'DATABASE_URL را بررسی کنید.' },
    WEBHOOK_MISMATCH: { fa: 'وب‌هوک ناهماهنگ', fix: 'PUBLIC_BASE_URL + telegram:set-webhooks' },
    POLLING_CONFLICT: { fa: 'دو نمونه ربات همزمان', fix: 'یکی را خاموش کنید.' },
    LOW_BALANCE: { fa: 'اعتبار NanoGPT کم', fix: 'حساب را شارژ کنید.' },
    INSUFFICIENT_BALANCE: { fa: 'اعتبار تمام شد', fix: 'فورا شارژ کنید.' },
    INDEXING_FAILED: { fa: 'فهرست‌سازی ناموفق', fix: 'Qdrant/OpenAI را بررسی کنید.' },
    WORKER_FAILED: { fa: 'پردازش پس‌زمینه خطا', fix: 'لاگ جزئیات را باز کنید.' },
    EXTERNAL_SERVICE_FAILURE: { fa: 'سرویس خارجی خطا', fix: 'OpenAI/Qdrant را بررسی کنید.' },
};
function sanitize(text, max = 500) {
    const t = text.trim().replace(/\s+/g, ' ');
    return t.length > max ? t.slice(0, max - 1) + '\u2026' : t;
}
function fpOf(input) {
    if (input.fingerprint)
        return sanitize(input.fingerprint, 64);
    const base = input.category + ':' + input.level + ':' + (input.errorCode ?? '') + ':' + input.message.slice(0, 120);
    return crypto.createHash('sha256').update(base).digest('hex').slice(0, 32);
}
export class SystemLogger {
    prisma;
    pino;
    config;
    dedup = new Map();
    lastPruneAt = 0;
    constructor(prisma, pino, config) {
        this.prisma = prisma;
        this.pino = pino;
        this.config = config;
    }
    shouldPersist(level) {
        if (!this.config.systemLog.enabled)
            return false;
        const need = levelSeverity[level] ?? 30;
        const threshold = dbLevelSeverity[this.config.systemLog.dbLevel] ?? 40;
        return need >= threshold;
    }
    pinoWrite(input) {
        const pLevel = input.level.toLowerCase();
        const fn = this.pino[pLevel];
        const payload = { category: input.category, errorCode: input.errorCode ?? undefined, correlationId: input.correlationId ?? undefined, businessAccountId: input.businessAccountId ?? undefined, fingerprint: fpOf(input), metadata: input.metadata ?? undefined };
        if (typeof fn === 'function')
            fn.call(this.pino, payload, input.message);
        else
            this.pino.info(payload, input.message);
    }
    async log(input) {
        const level = input.level;
        const category = input.category;
        const message = sanitize(input.message, 500);
        const messageFa = sanitize(input.messageFa || input.message, 500);
        const errorCode = input.errorCode ? sanitize(input.errorCode, 100) : null;
        const correlationId = input.correlationId ? sanitize(input.correlationId, 64) : null;
        const metadata = input.metadata ?? null;
        const fp = fpOf({ ...input, message, fingerprint: input.fingerprint ?? null });
        const businessAccountId = input.businessAccountId ?? null;
        this.pinoWrite({ ...input, message, messageFa, fingerprint: fp });
        if (!this.shouldPersist(level))
            return;
        const dedupKey = (businessAccountId ?? 'global') + ':' + fp;
        const now = Date.now();
        const dedupMs = this.config.systemLog.dedupMs;
        const existing = this.dedup.get(dedupKey);
        if (dedupMs > 0 && existing && now - existing.at < dedupMs) {
            try {
                await this.prisma.systemLog.update({ where: { id: existing.id }, data: { count: { increment: 1 }, metadata: metadata, updatedAt: new Date() } });
                this.dedup.set(dedupKey, { id: existing.id, at: now });
            }
            catch { }
            return;
        }
        const id = newId();
        try {
            await this.prisma.systemLog.create({ data: { id, businessAccountId, level, category, message, messageFa, errorCode, correlationId, fingerprint: fp, count: 1, metadata: metadata } });
            this.dedup.set(dedupKey, { id, at: now });
            if (this.dedup.size > 2000) {
                const first = this.dedup.keys().next().value;
                if (first)
                    this.dedup.delete(first);
            }
        }
        catch (error) {
            this.pino.warn({ err: error }, 'systemLog persist failed');
        }
    }
    trace(input) { void this.log({ ...input, level: 'TRACE' }); }
    debug(input) { void this.log({ ...input, level: 'DEBUG' }); }
    info(input) { void this.log({ ...input, level: 'INFO' }); }
    warn(input) { void this.log({ ...input, level: 'WARN' }); }
    error(input) { void this.log({ ...input, level: 'ERROR' }); }
    fatal(input) { void this.log({ ...input, level: 'FATAL' }); }
    async pruneIfDue() {
        const now = Date.now();
        if (now - this.lastPruneAt < 3600000)
            return 0;
        this.lastPruneAt = now;
        const cutoff = new Date(now - this.config.systemLog.retentionDays * 24 * 60 * 60 * 1000);
        try {
            const res = await this.prisma.systemLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
            if (res.count > 0)
                this.pino.info({ pruned: res.count }, 'systemLog retention pruned');
            return res.count;
        }
        catch {
            return 0;
        }
    }
    async list(params) {
        const page = Math.max(1, params.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
        const where = {};
        const and = [];
        if (params.businessAccountId)
            and.push({ OR: [{ businessAccountId: params.businessAccountId }, { businessAccountId: null }] });
        if (params.level)
            where['level'] = params.level;
        if (params.category)
            where['category'] = params.category;
        if (params.errorCode)
            where['errorCode'] = params.errorCode;
        if (params.from || params.to)
            where['createdAt'] = { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) };
        if (params.search) {
            const s = params.search.trim();
            if (s)
                and.push({ OR: [{ message: { contains: s } }, { messageFa: { contains: s } }, { errorCode: { contains: s } }, { correlationId: { contains: s } }] });
        }
        const finalWhere = { ...where };
        if (and.length)
            finalWhere['AND'] = and;
        const p = this.prisma;
        const [items, total] = await Promise.all([p.systemLog.findMany({ where: finalWhere, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), p.systemLog.count({ where: finalWhere })]);
        return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    }
    async get(id) {
        const p = this.prisma;
        return p.systemLog.findUnique({ where: { id } });
    }
    async summary(params) {
        const since = new Date(Date.now() - (params.sinceHours ?? 24) * 60 * 60 * 1000);
        const whereBase = { createdAt: { gte: since } };
        const and = [];
        if (params.businessAccountId)
            and.push({ OR: [{ businessAccountId: params.businessAccountId }, { businessAccountId: null }] });
        if (and.length)
            whereBase['AND'] = and;
        const p = this.prisma;
        const recent = await p.systemLog.findMany({ where: whereBase, orderBy: { createdAt: 'desc' }, take: 500 });
        const byLevel = {};
        const byCategory = {};
        const byError = {};
        for (const r of recent) {
            byLevel[r.level] = (byLevel[r.level] ?? 0) + (r.count ?? 1);
            byCategory[r.category] = (byCategory[r.category] ?? 0) + (r.count ?? 1);
            if (r.errorCode) {
                const cur = byError[r.errorCode] ?? { count: 0, messageFa: r.messageFa };
                cur.count += r.count ?? 1;
                byError[r.errorCode] = cur;
            }
        }
        const topErrors = Object.entries(byError).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map((e) => ({ errorCode: e[0], count: e[1].count, messageFa: e[1].messageFa, fix: fixHints[e[0]]?.fix }));
        const recentErrors = recent.filter((r) => r.level === 'ERROR' || r.level === 'FATAL').slice(0, 5);
        return { byLevel, byCategory, topErrors, recentErrors };
    }
}
//# sourceMappingURL=system-logger.js.map