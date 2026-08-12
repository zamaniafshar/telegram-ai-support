const labels: Record<string, string> = {
  OWNER: 'مالک',
  ADMIN: 'مدیر',
  SUPPORT: 'پشتیبان',
  AI: 'پاسخ‌گویی هوشمند',
  HUMAN: 'پشتیبانی انسانی',
  PENDING_HUMAN: 'در حال ارجاع',
  WAITING: 'در انتظار رسیدگی',
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
  if (['READY', 'RESOLVED', 'COMPLETED', 'AI', 'DELIVERED'].includes(status)) return 'success';
  if (['FAILED', 'ERROR', 'MISSING'].includes(status)) return 'error';
  if (
    ['WAITING', 'ACKNOWLEDGED', 'INDEXING', 'PENDING', 'HUMAN', 'RETRY', 'ATTENTION'].includes(
      status,
    )
  )
    return 'warning';
  return 'neutral';
}
