import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { newId } from '../utils/ids.js';

export type SystemLogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export type SystemLogCategory = 'WEBHOOK' | 'TELEGRAM' | 'AI' | 'RETRIEVAL' | 'INDEXING' | 'QDRANT' | 'WORKER' | 'HANDOFF' | 'AUTH' | 'SYSTEM' | 'CREDIT' | 'DATABASE' | 'HTTP';

const levelSeverity: Record<SystemLogLevel, number> = { TRACE: 10, DEBUG: 20, INFO: 30, WARN: 40, ERROR: 50, FATAL: 60 };
const dbLevelSeverity: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 999 };

export interface SystemLogInput {
  level: SystemLogLevel;
  category: SystemLogCategory;
  message: string;
  messageFa: string;
  businessAccountId?: string | null;
  errorCode?: string | null;
  correlationId?: string | null;
  fingerprint?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const fixHints: Record<string, { fa: string; fix: string }> = {
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

function sanitize(text: string, max = 500): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max - 1) + '\u2026' : t;
}
function fpOf(input: SystemLogInput): string {
  if (input.fingerprint) return sanitize(input.fingerprint, 64);
  const base = input.category + ':' + input.level + ':' + (input.errorCode ?? '') + ':' + input.message.slice(0, 120);
  return crypto.createHash('sha256').update(base).digest('hex').slice(0, 32);
}

export class SystemLogger {
  private dedup = new Map<string, { id: string; at: number }>();
  private lastPruneAt = 0;
  constructor(private readonly prisma: PrismaClient, private readonly pino: Logger, private readonly config: AppConfig) {}
  private shouldPersist(level: SystemLogLevel): boolean {
    if (!this.config.systemLog.enabled) return false;
    const need = levelSeverity[level] ?? 30;
    const threshold = dbLevelSeverity[this.config.systemLog.dbLevel] ?? 40;
    return need >= threshold;
  }
  private pinoWrite(input: SystemLogInput): void {
    const pLevel = input.level.toLowerCase() as 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    const fn = (this.pino as unknown as Record<string, (obj: unknown, msg: string) => void>)[pLevel];
    const payload = { category: input.category, errorCode: input.errorCode ?? undefined, correlationId: input.correlationId ?? undefined, businessAccountId: input.businessAccountId ?? undefined, fingerprint: fpOf(input), metadata: input.metadata ?? undefined };
    if (typeof fn === 'function') fn.call(this.pino, payload, input.message);
    else this.pino.info(payload, input.message);
  }
  async log(input: SystemLogInput): Promise<void> {
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
    if (!this.shouldPersist(level)) return;
    const dedupKey = (businessAccountId ?? 'global') + ':' + fp;
    const now = Date.now();
    const dedupMs = this.config.systemLog.dedupMs;
    const existing = this.dedup.get(dedupKey);
    if (dedupMs > 0 && existing && now - existing.at < dedupMs) {
      try {
        await (this.prisma as unknown as { systemLog: { update: (a: unknown) => Promise<void> } }).systemLog.update({ where: { id: existing.id }, data: { count: { increment: 1 }, metadata: metadata as never, updatedAt: new Date() } });
        this.dedup.set(dedupKey, { id: existing.id, at: now });
      } catch {}
      return;
    }
    const id = newId();
    try {
      await (this.prisma as unknown as { systemLog: { create: (a: unknown) => Promise<void> } }).systemLog.create({ data: { id, businessAccountId, level, category, message, messageFa, errorCode, correlationId, fingerprint: fp, count: 1, metadata: metadata as never } });
      this.dedup.set(dedupKey, { id, at: now });
      if (this.dedup.size > 2000) {
        const first = this.dedup.keys().next().value as string | undefined;
        if (first) this.dedup.delete(first);
      }
    } catch (error) {
      this.pino.warn({ err: error }, 'systemLog persist failed');
    }
  }
  trace(input: Omit<SystemLogInput, 'level'>): void { void this.log({ ...input, level: 'TRACE' }); }
  debug(input: Omit<SystemLogInput, 'level'>): void { void this.log({ ...input, level: 'DEBUG' }); }
  info(input: Omit<SystemLogInput, 'level'>): void { void this.log({ ...input, level: 'INFO' }); }
  warn(input: Omit<SystemLogInput, 'level'>): void { void this.log({ ...input, level: 'WARN' }); }
  error(input: Omit<SystemLogInput, 'level'>): void { void this.log({ ...input, level: 'ERROR' }); }
  fatal(input: Omit<SystemLogInput, 'level'>): void { void this.log({ ...input, level: 'FATAL' }); }
  async pruneIfDue(): Promise<number> {
    const now = Date.now();
    if (now - this.lastPruneAt < 3600000) return 0;
    this.lastPruneAt = now;
    const cutoff = new Date(now - this.config.systemLog.retentionDays * 24 * 60 * 60 * 1000);
    try {
      const res = await (this.prisma as unknown as { systemLog: { deleteMany: (a: unknown) => Promise<{ count: number }> } }).systemLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (res.count > 0) this.pino.info({ pruned: res.count }, 'systemLog retention pruned');
      return res.count;
    } catch { return 0; }
  }
  async list(params: { businessAccountId?: string | null; level?: SystemLogLevel | null; category?: SystemLogCategory | null; errorCode?: string | null; search?: string | null; from?: Date | null; to?: Date | null; page?: number; pageSize?: number }): Promise<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];
    if (params.businessAccountId) and.push({ OR: [{ businessAccountId: params.businessAccountId }, { businessAccountId: null }] });
    if (params.level) (where as Record<string, unknown>)['level'] = params.level;
    if (params.category) (where as Record<string, unknown>)['category'] = params.category;
    if (params.errorCode) (where as Record<string, unknown>)['errorCode'] = params.errorCode;
    if (params.from || params.to) (where as Record<string, unknown>)['createdAt'] = { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) };
    if (params.search) {
      const s = params.search.trim();
      if (s) and.push({ OR: [{ message: { contains: s } }, { messageFa: { contains: s } }, { errorCode: { contains: s } }, { correlationId: { contains: s } }] });
    }
    const finalWhere: Record<string, unknown> = { ...where };
    if (and.length) (finalWhere as Record<string, unknown>)['AND'] = and;
    const p = this.prisma as unknown as { systemLog: { findMany: (a: unknown) => Promise<unknown[]>; count: (a: unknown) => Promise<number> } };
    const [items, total] = await Promise.all([p.systemLog.findMany({ where: finalWhere, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), p.systemLog.count({ where: finalWhere })]);
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async get(id: string): Promise<unknown | null> {
    const p = this.prisma as unknown as { systemLog: { findUnique: (a: unknown) => Promise<unknown | null> } };
    return p.systemLog.findUnique({ where: { id } });
  }
  async summary(params: { businessAccountId?: string | null; sinceHours?: number }): Promise<{ byLevel: Record<string, number>; byCategory: Record<string, number>; topErrors: { errorCode: string; count: number; messageFa: string; fix?: string|undefined }[]; recentErrors: unknown[] }> {
    const since = new Date(Date.now() - (params.sinceHours ?? 24) * 60 * 60 * 1000);
    const whereBase: Record<string, unknown> = { createdAt: { gte: since } };
    const and: Record<string, unknown>[] = [];
    if (params.businessAccountId) and.push({ OR: [{ businessAccountId: params.businessAccountId }, { businessAccountId: null }] });
    if (and.length) (whereBase as Record<string, unknown>)['AND'] = and;
    const p = this.prisma as unknown as { systemLog: { findMany: (a: unknown) => Promise<Array<{ level: string; category: string; errorCode: string | null; messageFa: string; count: number; createdAt: Date }>> } };
    const recent = await p.systemLog.findMany({ where: whereBase, orderBy: { createdAt: 'desc' }, take: 500 });
    const byLevel: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byError: Record<string, { count: number; messageFa: string }> = {};
    for (const r of recent) {
      byLevel[r.level] = (byLevel[r.level] ?? 0) + (r.count ?? 1);
      byCategory[r.category] = (byCategory[r.category] ?? 0) + (r.count ?? 1);
      if (r.errorCode) {
        const cur = byError[r.errorCode] ?? { count: 0, messageFa: r.messageFa };
        cur.count += r.count ?? 1;
        byError[r.errorCode] = cur;
      }
    }
    const topErrors: { errorCode: string; count: number; messageFa: string; fix?: string|undefined }[] = Object.entries(byError).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map((e) => ({ errorCode: e[0], count: e[1].count, messageFa: e[1].messageFa, fix: fixHints[e[0]]?.fix }));
    const recentErrors = recent.filter((r) => r.level === 'ERROR' || r.level === 'FATAL').slice(0, 5);
    return { byLevel, byCategory, topErrors, recentErrors };
  }
}
