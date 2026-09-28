import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { newId } from '../utils/ids.js';
export const systemLogStorage = new AsyncLocalStorage();
export function isInsideSystemLogger() {
    return systemLogStorage.getStore()?.isSystemLog === true;
}
export function safeJsonValue(value, seen = new WeakSet()) {
    if (value === null || value === undefined)
        return value;
    if (typeof value === 'bigint')
        return value.toString();
    if (typeof value === 'number' || typeof value === 'boolean') {
        return Number.isNaN(value) ? null : value;
    }
    if (typeof value === 'string') {
        return value.length > 5000 ? value.slice(0, 5000) + '…' : value;
    }
    if (typeof value === 'symbol' || typeof value === 'function') {
        return value.toString();
    }
    if (value instanceof Date)
        return value.toISOString();
    if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
    }
    if (typeof value === 'object') {
        if (seen.has(value))
            return '[Circular]';
        seen.add(value);
        if (Array.isArray(value)) {
            return value.map((item) => safeJsonValue(item, seen));
        }
        const res = {};
        for (const [k, v] of Object.entries(value)) {
            res[k] = safeJsonValue(v, seen);
        }
        return res;
    }
    return null;
}
const levelSeverity = {
    TRACE: 10,
    DEBUG: 20,
    INFO: 30,
    WARN: 40,
    ERROR: 50,
    FATAL: 60,
};
const dbLevelSeverity = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
    silent: 999,
};
export const fixHints = {
    TELEGRAM_REPLY_WINDOW_EXPIRED: {
        fa: 'پنجره 24ساعته تلگرام منقضی شده',
        fix: 'منتظر پیام جدید مشتری بمانید یا از پنل پیام انسانی ارسال کنید.',
    },
    TELEGRAM_API_429: {
        fa: 'تلگرام محدودیت نرخ اعمال کرده',
        fix: 'چند دقیقه صبر کنید. ربات خودکار تلاش می‌کند.',
    },
    TELEGRAM_NETWORK_ERROR: {
        fa: 'ارتباط با تلگرام برقرار نشد',
        fix: 'api.telegram.org را بررسی کنید.',
    },
    WEBHOOK_UNAUTHORIZED: {
        fa: 'توکن وب‌هوک اشتباه است',
        fix: 'SECRET در .env را با telegram:set-webhooks همگام کنید.',
    },
    WEBHOOK_INVALID_PAYLOAD: {
        fa: 'بدنه وب‌هوک نامعتبر',
        fix: 'نسخه ربات را به‌روز کنید.',
    },
    BUSINESS_CONNECTION_DISABLED: {
        fa: 'اتصال تجاری غیرفعال',
        fix: 'Settings > Telegram Business > Chatbots را چک کنید.',
    },
    BUSINESS_CANNOT_REPLY: {
        fa: 'دسترسی پاسخ ندارد',
        fix: 'can_reply را در Chatbot فعال کنید.',
    },
    QDRANT_UNHEALTHY: {
        fa: 'Qdrant در دسترس نیست',
        fix: 'QDRANT_URL/API_KEY را بررسی کنید.',
    },
    MYSQL_UNHEALTHY: {
        fa: 'MySQL در دسترس نیست',
        fix: 'DATABASE_URL را بررسی کنید.',
    },
    WEBHOOK_MISMATCH: {
        fa: 'وب‌هوک ناهماهنگ',
        fix: 'PUBLIC_BASE_URL + telegram:set-webhooks',
    },
    POLLING_CONFLICT: {
        fa: 'دو نمونه ربات همزمان',
        fix: 'یکی را خاموش کنید.',
    },
    LOW_BALANCE: {
        fa: 'اعتبار NanoGPT کم',
        fix: 'حساب را شارژ کنید.',
    },
    INSUFFICIENT_BALANCE: {
        fa: 'اعتبار تمام شد',
        fix: 'فورا شارژ کنید.',
    },
    INDEXING_FAILED: {
        fa: 'فهرست‌سازی ناموفق',
        fix: 'Qdrant/OpenAI را بررسی کنید.',
    },
    WORKER_FAILED: {
        fa: 'پردازش پس‌زمینه خطا',
        fix: 'لاگ جزئیات را باز کنید.',
    },
    EXTERNAL_SERVICE_FAILURE: {
        fa: 'سرویس خارجی خطا',
        fix: 'OpenAI/Qdrant را بررسی کنید.',
    },
};
function sanitize(text, max = 500) {
    const t = text.trim().replace(/\s+/g, ' ');
    return t.length > max ? t.slice(0, max - 1) + '\u2026' : t;
}
function fpOf(input) {
    if (input.fingerprint)
        return sanitize(input.fingerprint, 64);
    const base = `${input.category}:${input.level}:${input.errorCode ?? ''}:${input.message.slice(0, 120)}`;
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
    attachToLogger(logger) {
        const l = logger;
        if (typeof l?.attachSink === 'function') {
            l.attachSink((record) => {
                void this.ingestPinoRecord(record);
            });
        }
    }
    shouldPersist(level) {
        if (!this.config.systemLog.enabled)
            return false;
        const need = levelSeverity[level];
        const threshold = dbLevelSeverity[this.config.systemLog.dbLevel] ?? 40;
        return need >= threshold;
    }
    pinoWrite(input) {
        const pLevel = input.level.toLowerCase();
        const fn = this.pino[pLevel];
        const payload = {
            _fromSystemLogger: true,
            category: input.category,
            errorCode: input.errorCode ?? undefined,
            correlationId: input.correlationId ?? undefined,
            businessAccountId: input.businessAccountId ?? undefined,
            fingerprint: fpOf(input),
            metadata: input.metadata ?? undefined,
        };
        if (typeof fn === 'function') {
            fn.call(this.pino, payload, input.message);
        }
        else {
            this.pino.info(payload, input.message);
        }
    }
    async ingestPinoRecord(record) {
        if (record['_fromSystemLogger'] === true || isInsideSystemLogger())
            return;
        const rawQuery = typeof record['query'] === 'string' ? record['query'] : '';
        const rawMsg = typeof record['msg'] === 'string'
            ? record['msg']
            : typeof record['message'] === 'string'
                ? record['message']
                : 'system event';
        if (/systemlog/i.test(rawQuery) || /systemlog/i.test(rawMsg))
            return;
        const levelNum = typeof record['level'] === 'number' ? record['level'] : 30;
        let level;
        if (levelNum <= 10)
            level = 'TRACE';
        else if (levelNum <= 20)
            level = 'DEBUG';
        else if (levelNum <= 30)
            level = 'INFO';
        else if (levelNum <= 40)
            level = 'WARN';
        else if (levelNum <= 50)
            level = 'ERROR';
        else
            level = 'FATAL';
        if (!this.shouldPersist(level))
            return;
        let message;
        let messageFa;
        const req = record['req'];
        const res = record['res'];
        if (rawQuery) {
            const rt = typeof record['durationMs'] === 'number' ? ` (${String(record['durationMs'])}ms)` : '';
            message = `db query${rt}: ${sanitize(rawQuery, 450)}`;
            messageFa = `پرس‌وجوی پایگاه داده${rt}`;
        }
        else if (req && typeof req === 'object') {
            const method = req.method ?? 'HTTP';
            const url = req.url ?? '/';
            const status = res?.statusCode ? ` -> ${String(res.statusCode)}` : '';
            const rt = typeof record['responseTime'] === 'number'
                ? ` (${String(Math.round(record['responseTime']))}ms)`
                : '';
            message = `${method} ${url}${status}${rt}`;
            messageFa = `درخواست وب: ${method} ${url}${res?.statusCode ? ` [${String(res.statusCode)}]` : ''}`;
        }
        else {
            message = rawMsg;
            messageFa = typeof record['messageFa'] === 'string' ? record['messageFa'] : message;
        }
        const rawCategory = typeof record['category'] === 'string' ? record['category'].toUpperCase() : '';
        const validCategories = [
            'WEBHOOK',
            'TELEGRAM',
            'AI',
            'RETRIEVAL',
            'INDEXING',
            'QDRANT',
            'WORKER',
            'HANDOFF',
            'AUTH',
            'SYSTEM',
            'CREDIT',
            'DATABASE',
            'HTTP',
        ];
        let category = 'SYSTEM';
        if (validCategories.includes(rawCategory)) {
            category = rawCategory;
        }
        else if (rawQuery) {
            category = 'DATABASE';
        }
        else {
            const lower = message.toLowerCase();
            if (req ||
                res ||
                typeof record['reqId'] === 'string' ||
                lower.includes('request completed')) {
                category = 'HTTP';
            }
            else if (lower.includes('webhook') || record['webhook'] !== undefined) {
                category = 'WEBHOOK';
            }
            else if (lower.includes('telegram') ||
                lower.includes('polling') ||
                record['telegram'] !== undefined ||
                record['botKind'] !== undefined) {
                category = 'TELEGRAM';
            }
            else if (lower.includes('qdrant') || record['qdrant'] !== undefined) {
                category = 'QDRANT';
            }
            else if (lower.includes('index') || record['indexing'] !== undefined) {
                category = 'INDEXING';
            }
            else if (lower.includes('worker') ||
                record['worker'] !== undefined ||
                record['job'] !== undefined) {
                category = 'WORKER';
            }
            else if (lower.includes('ai') ||
                lower.includes('model') ||
                lower.includes('nanogpt') ||
                lower.includes('openai') ||
                record['ai'] !== undefined) {
                category = 'AI';
            }
            else if (lower.includes('credit') ||
                lower.includes('balance') ||
                record['credit'] !== undefined) {
                category = 'CREDIT';
            }
            else if (lower.includes('handoff') || record['handoff'] !== undefined) {
                category = 'HANDOFF';
            }
            else if (lower.includes('auth') ||
                lower.includes('session') ||
                record['auth'] !== undefined) {
                category = 'AUTH';
            }
            else if (lower.includes('prisma') ||
                lower.includes('database') ||
                lower.includes('mysql') ||
                record['query'] !== undefined) {
                category = 'DATABASE';
            }
        }
        let businessAccountId = null;
        if (typeof record['businessAccountId'] === 'string') {
            businessAccountId = record['businessAccountId'];
        }
        else if (typeof record['businessId'] === 'string') {
            businessAccountId = record['businessId'];
        }
        else if (req?.url) {
            const match = /\/businesses\/([0-9a-fA-F-]{36})/i.exec(req.url);
            if (match)
                businessAccountId = match[1] ?? null;
        }
        const correlationId = typeof record['correlationId'] === 'string'
            ? record['correlationId']
            : typeof record['reqId'] === 'string'
                ? record['reqId']
                : null;
        const errorCode = typeof record['errorCode'] === 'string'
            ? record['errorCode']
            : typeof record['err']?.code === 'string'
                ? record['err'].code
                : null;
        if (errorCode && fixHints[errorCode]) {
            messageFa = fixHints[errorCode].fa;
        }
        else if (message === 'application started') {
            messageFa = 'سامانه با موفقیت راه‌اندازی شد';
        }
        else if (message === 'request completed') {
            messageFa = 'درخواست وب تکمیل شد';
        }
        const metadata = {};
        const skipKeys = new Set([
            'level',
            'time',
            'pid',
            'hostname',
            'service',
            'env',
            'msg',
            'message',
            'messageFa',
            'category',
            'errorCode',
            'correlationId',
            'businessAccountId',
            '_fromSystemLogger',
        ]);
        for (const [k, v] of Object.entries(record)) {
            if (!skipKeys.has(k) && v !== undefined) {
                metadata[k] = safeJsonValue(v);
            }
        }
        await this.persistInternal({
            level,
            category,
            message,
            messageFa,
            errorCode,
            correlationId,
            businessAccountId,
            metadata: Object.keys(metadata).length ? metadata : null,
        }, false);
    }
    async log(input) {
        await this.persistInternal(input, true);
    }
    async persistInternal(input, isDirectLog) {
        const level = input.level;
        const category = input.category;
        const message = sanitize(input.message, 500);
        const messageFa = sanitize(input.messageFa || input.message, 500);
        const errorCode = input.errorCode ? sanitize(input.errorCode, 100) : null;
        const correlationId = input.correlationId ? sanitize(input.correlationId, 64) : null;
        const metadata = input.metadata
            ? safeJsonValue(input.metadata)
            : null;
        const fp = fpOf({ ...input, message, fingerprint: input.fingerprint ?? null });
        const businessAccountId = input.businessAccountId ?? null;
        if (isDirectLog) {
            this.pinoWrite({ ...input, message, messageFa, fingerprint: fp, metadata });
        }
        if (!this.shouldPersist(level))
            return;
        const isErrorOrWarn = level === 'WARN' || level === 'ERROR' || level === 'FATAL';
        const dedupMs = this.config.systemLog.dedupMs;
        const shouldDedup = isErrorOrWarn && dedupMs > 0 && !correlationId;
        const dedupKey = `${businessAccountId ?? 'global'}:${fp}`;
        const now = Date.now();
        const existing = shouldDedup ? this.dedup.get(dedupKey) : undefined;
        if (existing && now - existing.at < dedupMs) {
            await systemLogStorage.run({ isSystemLog: true }, async () => {
                try {
                    await this.prisma.systemLog.update({
                        where: { id: existing.id },
                        data: { count: { increment: 1 }, metadata: metadata, updatedAt: new Date() },
                    });
                    this.dedup.set(dedupKey, { id: existing.id, at: now });
                }
                catch {
                    // Ignore update failure to prevent crashing
                }
            });
            return;
        }
        const id = newId();
        await systemLogStorage.run({ isSystemLog: true }, async () => {
            try {
                await this.prisma.systemLog.create({
                    data: {
                        id,
                        businessAccountId,
                        level,
                        category,
                        message,
                        messageFa,
                        errorCode,
                        correlationId,
                        fingerprint: fp,
                        count: 1,
                        metadata: metadata,
                    },
                });
                if (shouldDedup) {
                    this.dedup.set(dedupKey, { id, at: now });
                    if (this.dedup.size > 2000) {
                        const first = this.dedup.keys().next().value;
                        if (first)
                            this.dedup.delete(first);
                    }
                }
            }
            catch (error) {
                this.pino.warn({ _fromSystemLogger: true, err: error }, 'systemLog persist failed');
            }
        });
    }
    trace(input) {
        void this.log({ ...input, level: 'TRACE' });
    }
    debug(input) {
        void this.log({ ...input, level: 'DEBUG' });
    }
    info(input) {
        void this.log({ ...input, level: 'INFO' });
    }
    warn(input) {
        void this.log({ ...input, level: 'WARN' });
    }
    error(input) {
        void this.log({ ...input, level: 'ERROR' });
    }
    fatal(input) {
        void this.log({ ...input, level: 'FATAL' });
    }
    async pruneIfDue() {
        const now = Date.now();
        if (now - this.lastPruneAt < 3600000)
            return 0;
        this.lastPruneAt = now;
        const cutoff = new Date(now - this.config.systemLog.retentionDays * 24 * 60 * 60 * 1000);
        return systemLogStorage.run({ isSystemLog: true }, async () => {
            try {
                const res = await this.prisma.systemLog.deleteMany({
                    where: { createdAt: { lt: cutoff } },
                });
                if (res.count > 0) {
                    this.pino.info({ _fromSystemLogger: true, pruned: res.count }, 'systemLog retention pruned');
                }
                return res.count;
            }
            catch {
                return 0;
            }
        });
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
            return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
        });
    }
    async get(id) {
        return systemLogStorage.run({ isSystemLog: true }, async () => {
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
        return systemLogStorage.run({ isSystemLog: true }, async () => {
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
                .map((e) => {
                const res = {
                    errorCode: e[0],
                    count: e[1].count,
                    messageFa: e[1].messageFa,
                };
                const hint = fixHints[e[0]]?.fix;
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
}
//# sourceMappingURL=system-logger.js.map