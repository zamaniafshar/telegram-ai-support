const labels: Record<string, string> = {
  OWNER: 'مالک',
  ADMIN: 'مدیر',
  SUPPORT: 'پشتیبان',
  AI: 'پاسخ‌گویی هوشمند',
  HUMAN: 'پشتیبانی انسانی',
  PENDING_HUMAN: 'در حال ارجاع',
  WAITING: 'در انتظار رسیدگی',
  NONE: 'بدون ارجاع',
  ACKNOWLEDGED: 'پذیرفته‌شده',
  RESOLVED: 'حل‌شده',
  EXPIRED: 'پایان‌یافته',
  PENDING: 'در صف پردازش',
  INDEXING: 'در حال پردازش',
  READY: 'آماده استفاده',
  FAILED: 'ناموفق',
  PROCESSING: 'در حال پردازش',
  COMPLETED: 'تکمیل‌شده',
  RETRY: 'در انتظار تلاش دوباره',
  CUSTOMER: 'مشتری',
  HUMAN_SENDER: 'پشتیبان',
  SYSTEM: 'سامانه',
  INCOMING: 'دریافتی',
  OUTGOING: 'ارسالی',
  EXPLICIT_HUMAN_REQUEST: 'درخواست مستقیم پشتیبان انسانی',
  AI_NOT_ANSWERABLE: 'نبود پاسخ مستند و مطمئن',
  EXTERNAL_SERVICE_FAILURE: 'اختلال در سرویس پردازش',
  Conversation: 'گفتگو',
  KnowledgeItem: 'دانش',
  Admin: 'مدیر',
  BusinessConnection: 'اتصال تجاری',
  AdminSession: 'نشست مدیریتی',
  SENT: 'ارسال‌شده',
  HANDOFF: 'ارجاع انسانی',
  SUPPRESSED: 'ارسال‌نشده',
  GROUNDED_ANSWER: 'پاسخ مستند',
  SOCIAL_REPLY: 'پاسخ اجتماعی',
  SAFE_GREETING: 'پاسخ خوشامدگویی',
  KNOWLEDGE_MISSING_OR_INACTIVE: 'دانش حذف یا غیرفعال شده است',
  VERSION_MISMATCH: 'نسخه دانش با MySQL هم‌خوان نیست',
  EXACT_ANSWER: 'پاسخ مستقیم FAQ',
  COPY_PASTE_EXACT_MATCH: 'پاسخ مستقیم کپی‌پیست (FAQ)',
  EXACT_FAQ_MATCH: 'انطباق قطعی با سوال متداول (FAQ)',
  KNOWLEDGE: 'دانش RAG',
  ACTIVE: 'فعال',
  INACTIVE: 'غیرفعال',
  AI_ABUSE_HOURLY_LIMIT: 'محدودیت تعداد پیام در ساعت (ضد هرزنامه)',
  AI_ABUSE_DAILY_LIMIT: 'محدودیت تعداد پیام در روز (ضد هرزنامه)',
  AI_ABUSE_COOLDOWN_ACTIVE: 'محدودیت موقت پیام فعال است',
  AI_ABUSE_BATCH_TOO_LARGE: 'حجم پیام‌ها بیش از حد مجاز است',
  AI_BUSINESS_HOURLY_BUDGET_LIMIT: 'سقف مصرف ساعتی کسب‌وکار تکمیل شده',
  AI_BUSINESS_DAILY_BUDGET_LIMIT: 'سقف مصرف روزانه کسب‌وکار تکمیل شده',
  AI_BUSINESS_BUDGET_COOLDOWN_ACTIVE: 'دوره استراحت بودجه هوش مصنوعی کسب‌وکار',
  HUMAN_MODE: 'حالت گفتگوی انسانی',
  HUMAN_REPLIED: 'پشتیبان انسانی پاسخ داده است',
  BACKLOG_EXPIRED: 'انقضای پنجره زمانی پاسخ‌گویی',
  MASTER_DISABLED: 'پاسخ‌گویی هوشمند غیرفعال است',
  OUTSIDE_HOURS: 'خارج از ساعات کاری',
  OPENAI_TIMEOUT: 'پایان مهلت زمانی ارتباط با مدل هوش مصنوعی',
  OPENAI_RATE_LIMIT: 'محدودیت نرخ درخواست هوش مصنوعی',
  OPENAI_AUTH_ERROR: 'خطای کلید یا احراز هویت هوش مصنوعی',
  QDRANT_UNAVAILABLE: 'موتور برداری Qdrant در دسترس نیست',
  NETWORK_ERROR: 'خطای شبکه در ارتباط با سرویس هوش مصنوعی',
  FETCH_ERROR: 'خطای ارتباطی با وب‌سرویس هوش مصنوعی',
  EMPTY_OR_DELETED_MESSAGE: 'پیام خالی یا حذف‌شده',
  NO_RELEVANT_KNOWLEDGE: 'دانش مرتبطی برای پاسخ یافت نشد',
};

export const outcomeLabels: Record<string, string> = {
  ANSWERED_BY_SUPPORT: 'پاسخ توسط پشتیبان ارائه شد',
  CUSTOMER_NEED_RESOLVED: 'نیاز مشتری برطرف شد',
  CUSTOMER_NO_RESPONSE: 'مشتری پاسخ نداد',
  INCORRECT_HANDOFF: 'ارجاع اشتباه بود',
  SERVICE_ISSUE: 'مشکل اتصال یا سرویس',
  OTHER: 'سایر',
};

export function faLabel(value?: string | null): string {
  if (!value) return 'نامشخص';
  return labels[value] ?? value;
}

export function formatDate(value?: string | null, relative = false): string {
  if (!value) return 'ثبت نشده';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ثبت نشده';
  if (relative) {
    const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
    const formatter = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 48) return formatter.format(hours, 'hour');
    return formatter.format(Math.round(hours / 24), 'day');
  }
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function statusTone(status: string): string {
  if (['READY', 'RESOLVED', 'COMPLETED', 'AI', 'DELIVERED', 'SENT'].includes(status))
    return 'success';
  if (['FAILED', 'ERROR', 'MISSING', 'SUPPRESSED'].includes(status)) return 'error';
  if (
    ['WAITING', 'ACKNOWLEDGED', 'INDEXING', 'PENDING', 'HUMAN', 'RETRY', 'ATTENTION'].includes(
      status,
    )
  )
    return 'warning';
  return 'neutral';
}
