import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export const systemLogStorage = new AsyncLocalStorage<{ isSystemLog: boolean }>();

export function isInsideSystemLogger(): boolean {
  return systemLogStorage.getStore()?.isSystemLog === true;
}

export type SystemLogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export type PinoLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export type SystemLogCategory =
  | 'WEBHOOK'
  | 'TELEGRAM'
  | 'AI'
  | 'RETRIEVAL'
  | 'INDEXING'
  | 'QDRANT'
  | 'WORKER'
  | 'HANDOFF'
  | 'AUTH'
  | 'SYSTEM'
  | 'CREDIT'
  | 'DATABASE'
  | 'HTTP';

export const VALID_CATEGORIES: readonly SystemLogCategory[] = [
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
] as const;

export const levelSeverity: Record<SystemLogLevel, number> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60,
};

export const dbLevelSeverity: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 999,
};

export interface SystemLogEntry {
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

export type SystemLogInput = SystemLogEntry;

export const fixHints: Record<string, { fa: string; fix: string }> = {
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

export function sanitize(text: string, max = 500): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max - 1) + '\u2026' : t;
}

export function fpOf(
  input: Pick<SystemLogEntry, 'category' | 'level' | 'errorCode' | 'message' | 'fingerprint'>,
): string {
  if (input.fingerprint) return sanitize(input.fingerprint, 64);
  const base = `${input.category}:${input.level}:${input.errorCode ?? ''}:${input.message.slice(0, 120)}`;
  return crypto.createHash('sha256').update(base).digest('hex').slice(0, 32);
}

export function safeJsonValue(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'string') {
    return value.length > 5000 ? value.slice(0, 5000) + '…' : value;
  }
  if (typeof value === 'symbol' || typeof value === 'function') {
    return value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((item) => safeJsonValue(item, seen));
    }
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      res[k] = safeJsonValue(v, seen);
    }
    return res;
  }
  return null;
}
