import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { request } from '../../core/api';
import { faLabel, formatDate } from '../../core/format';
import type { HandoffSummary, HostHealth } from '../../core/types';
import { Badge, Card, EmptyState, KeyValue, PageHeader, QueryState } from '../../components/ui';
import { useSession } from '../../app/SessionProvider';

interface Dashboard {
  business: { id: string; name: string; locale: string };
  metrics: {
    waitingHandoffs: number;
    humanConversations: number;
    failedKnowledge: number;
    conversationsToday: number;
  };
  connection: { status: string; updatedAt: string | null };
  recentHandoffs: HandoffSummary[];
  hostOverloaded?: boolean;
}

export function OverviewPage() {
  const { businessPath } = useSession();
  const query = useQuery({
    queryKey: ['dashboard', businessPath('')],
    queryFn: () => request<Dashboard>(businessPath('/dashboard')),
  });
  const data = query.data;
  return (
    <QueryState pending={query.isPending} error={query.error}>
      {data && (
        <>
          <PageHeader title="نمای کلی" subtitle={data.business.name} />
          {data.hostOverloaded && (
            <div className="red-flag-banner">
              <div className="red-flag-icon">🚨</div>
              <div className="red-flag-content">
                <strong>اخطار بحرانی: مصرف منابع هاست بیش از ۸۰٪ است</strong>
                <p>مصرف CPU یا حافظه به مدت بیش از ۲ ساعت مداوم در وضعیت بحرانی قرار دارد.</p>
              </div>
              <Link to="/system" className="btn-alert-link">
                مشاهده منابع
              </Link>
            </div>
          )}
          <div className="metric-grid">
            <div className="metric">
              <span>◉</span>
              <strong>{data.metrics.waitingHandoffs.toLocaleString('fa-IR')}</strong>
              <small>ارجاع در انتظار</small>
            </div>
            <div className="metric">
              <span>♙</span>
              <strong>{data.metrics.humanConversations.toLocaleString('fa-IR')}</strong>
              <small>پشتیبانی انسانی</small>
            </div>
            <div className="metric">
              <span>◌</span>
              <strong>{data.metrics.conversationsToday.toLocaleString('fa-IR')}</strong>
              <small>گفتگوی فعال امروز</small>
            </div>
            <div className="metric">
              <span>▤</span>
              <strong>{data.metrics.failedKnowledge.toLocaleString('fa-IR')}</strong>
              <small>دانش ناموفق</small>
            </div>
          </div>
          <div className="section-head">
            <h3>ارجاع‌های فعال</h3>
            <Link to="/handoffs">مشاهده همه</Link>
          </div>
          <div className="list">
            {data.recentHandoffs.length ? (
              data.recentHandoffs.map((item) => (
                <Link className="list-card" to={`/handoffs/${item.conversationId}`} key={item.id}>
                  <div className="list-main">
                    <strong>{item.customerName}</strong>
                    <span>{faLabel(item.status)}</span>
                  </div>
                  <div className="list-meta">
                    <Badge status={item.status} />
                    <time>{formatDate(item.startedAt, true)}</time>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyState
                title="ارجاع فعالی وجود ندارد"
                description="همه درخواست‌ها رسیدگی شده‌اند."
              />
            )}
          </div>
        </>
      )}
    </QueryState>
  );
}

interface Connection {
  id?: string;
  enabled: boolean;
  canReply: boolean;
  connectedAt: string | null;
  disabledAt: string | null;
  updatedAt: string;
  rights?: unknown;
}

export function ConnectionsPage() {
  const { businessPath } = useSession();
  const query = useQuery({
    queryKey: ['connections', businessPath('')],
    queryFn: () => request<Connection[]>(businessPath('/connections')),
  });
  return (
    <>
      <PageHeader title="اتصال تجاری" subtitle="وضعیت ارتباط و مجوز پاسخ‌گویی" />
      <QueryState pending={query.isPending} error={query.error}>
        <div className="grid">
          {query.data?.length ? (
            query.data.map((item, index) => (
              <Card key={item.id ?? index}>
                <div className="page-head">
                  <h3>حساب تجاری تلگرام</h3>
                  <Badge status={item.enabled && item.canReply ? 'READY' : 'ATTENTION'}>
                    {item.enabled && item.canReply ? 'آماده پاسخ‌گویی' : 'نیازمند بررسی'}
                  </Badge>
                </div>
                <div className="key-values">
                  <KeyValue label="اتصال">{item.enabled ? 'فعال' : 'غیرفعال'}</KeyValue>
                  <KeyValue label="اجازه پاسخ‌گویی">{item.canReply ? 'دارد' : 'ندارد'}</KeyValue>
                  <KeyValue label="آخرین تغییر">{formatDate(item.updatedAt)}</KeyValue>
                </div>
              </Card>
            ))
          ) : (
            <EmptyState
              icon="⌁"
              title="اتصال تجاری ثبت نشده است"
              description="ربات تجاری را از تنظیمات حساب پشتیبانی متصل کنید."
            />
          )}
        </div>
      </QueryState>
    </>
  );
}

interface Health {
  ready: boolean;
  checks?: Record<string, boolean>;
  queues?: Record<string, { status: string; _count: number }[]>;
  host?: HostHealth;
}
const checkNames: Record<string, string> = {
  process: 'فرایند اصلی',
  configuration: 'پیکربندی',
  mysql: 'پایگاه داده',
  qdrant: 'بازیابی دانش',
  businessWebhook: 'دریافت پیام مشتری',
  adminWebhook: 'ربات مدیریت',
};

export function SystemPage() {
  const { businessPath } = useSession();
  const query = useQuery({
    queryKey: ['system', businessPath('')],
    queryFn: () => request<Health>(businessPath('/system')),
  });
  const health = query.data;
  return (
    <>
      <PageHeader
        title="سلامت سامانه"
        subtitle={
          health?.host?.isOverloaded
            ? '🚨 اخطار بحرانی مصرف منابع هاست'
            : health?.ready
              ? 'وضعیت کلی سالم است'
              : 'وضعیت سرویس‌ها و پردازش‌های پس‌زمینه'
        }
      />
      <QueryState pending={query.isPending} error={query.error}>
        {health && (
          <>
            {health.host?.isOverloaded && (
              <div className="red-flag-banner">
                <div className="red-flag-icon">🚨</div>
                <div className="red-flag-content">
                  <strong>اخطار بحرانی: مصرف منابع هاست بیش از ۸۰٪ است</strong>
                  <p>
                    مصرف CPU یا حافظه به مدت بیش از{' '}
                    {health.host.overloadDurationHours.toLocaleString('fa-IR')} ساعت مداوم بالاتر از
                    ۸۰٪ گزارش شده است (پردازنده:{' '}
                    {health.host.cpuPercent.toLocaleString('fa-IR')}٪، رم:{' '}
                    {health.host.memoryPercent.toLocaleString('fa-IR')}٪).
                  </p>
                </div>
              </div>
            )}
            <div className={`notice ${health.ready && !health.host?.isOverloaded ? '' : 'error'}`}>
              <span>{health.ready && !health.host?.isOverloaded ? '✓' : '!'}</span>
              <div>
                <strong>
                  {health.ready && !health.host?.isOverloaded
                    ? 'سامانه آماده پاسخ‌گویی است'
                    : 'سامانه نیازمند بررسی است'}
                </strong>
                <p>
                  {health.ready && !health.host?.isOverloaded
                    ? 'سرویس‌های اصلی بدون اختلال گزارش شده‌اند.'
                    : 'یک یا چند سرویس اصلی یا منابع سرور در وضعیت نامطلوب است.'}
                </p>
              </div>
            </div>
            {health.host && (
              <Card title="مصرف منابع هاست و سرور">
                <div className="resource-item">
                  <div className="resource-label-row">
                    <span>پردازنده (CPU)</span>
                    <Badge
                      status={
                        health.host.cpuPercent >= 80
                          ? 'FAILED'
                          : health.host.cpuPercent >= 60
                            ? 'ATTENTION'
                            : 'READY'
                      }
                    >
                      {health.host.cpuPercent.toLocaleString('fa-IR')}٪
                    </Badge>
                  </div>
                  <div className="resource-progress-bar">
                    <div
                      className={`resource-progress-fill ${
                        health.host.cpuPercent >= 80
                          ? 'critical'
                          : health.host.cpuPercent >= 60
                            ? 'warning'
                            : 'normal'
                      }`}
                      style={{ width: `${Math.min(100, health.host.cpuPercent)}%` }}
                    />
                  </div>
                </div>

                <div className="resource-item">
                  <div className="resource-label-row">
                    <span>حافظه سرور (RAM)</span>
                    <Badge
                      status={
                        health.host.memoryPercent >= 80
                          ? 'FAILED'
                          : health.host.memoryPercent >= 60
                            ? 'ATTENTION'
                            : 'READY'
                      }
                    >
                      {health.host.memoryUsedMb.toLocaleString('fa-IR')} /{' '}
                      {health.host.memoryTotalMb.toLocaleString('fa-IR')} مگابایت (
                      {health.host.memoryPercent.toLocaleString('fa-IR')}٪)
                    </Badge>
                  </div>
                  <div className="resource-progress-bar">
                    <div
                      className={`resource-progress-fill ${
                        health.host.memoryPercent >= 80
                          ? 'critical'
                          : health.host.memoryPercent >= 60
                            ? 'warning'
                            : 'normal'
                      }`}
                      style={{ width: `${Math.min(100, health.host.memoryPercent)}%` }}
                    />
                  </div>
                </div>

                <div className="key-values" style={{ marginTop: '12px' }}>
                  <KeyValue label="حافظه پردازش ربات (RSS)">
                    {health.host.processMemoryMb.toLocaleString('fa-IR')} مگابایت
                  </KeyValue>
                  <KeyValue label="وضعیت پایداری مصرف">
                    <Badge
                      status={
                        health.host.isOverloaded
                          ? 'FAILED'
                          : health.host.continuousHighUsageMinutes > 0
                            ? 'ATTENTION'
                            : 'READY'
                      }
                    >
                      {health.host.isOverloaded
                        ? 'بحرانی (بیش از ۲ ساعت بالای ۸۰٪)'
                        : health.host.continuousHighUsageMinutes > 0
                          ? `${health.host.continuousHighUsageMinutes.toLocaleString('fa-IR')} دقیقه بالای ۸۰٪`
                          : 'عادی (پایدار)'}
                    </Badge>
                  </KeyValue>
                  {health.host.lastCheckedAt && (
                    <KeyValue label="آخرین بررسی منابع">
                      {formatDate(health.host.lastCheckedAt, true)}
                    </KeyValue>
                  )}
                </div>
              </Card>
            )}
            <div className="split-grid">
              <Card title="بررسی سرویس‌ها">
                <div className="key-values">
                  {health.checks ? (
                    Object.entries(health.checks).map(([key, value]) => (
                      <KeyValue key={key} label={checkNames[key] ?? key}>
                        <Badge status={value ? 'READY' : 'FAILED'}>
                          {value ? 'سالم' : 'نیازمند بررسی'}
                        </Badge>
                      </KeyValue>
                    ))
                  ) : (
                    <p className="muted">وضعیت کلی سامانه برای نقش شما نمایش داده شده است.</p>
                  )}
                </div>
              </Card>
              {health.queues && (
                <Card title="صف‌های پردازش">
                  {Object.entries(health.queues).map(([name, groups]) => (
                    <details key={name}>
                      <summary>
                        {name === 'indexing'
                          ? 'پردازش دانش'
                          : name === 'conversations'
                            ? 'پاسخ‌گویی گفتگوها'
                            : 'ارسال اعلان‌ها'}
                      </summary>
                      {groups.map((group) => (
                        <KeyValue key={group.status} label={faLabel(group.status)}>
                          {group._count.toLocaleString('fa-IR')}
                        </KeyValue>
                      ))}
                    </details>
                  ))}
                </Card>
              )}
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}

interface Settings {
  humanModeHours: number;
  notifyAdditionalMessages: boolean;
  customerAcknowledgementEnabled: boolean;
}
export function SettingsPage() {
  const { businessPath } = useSession();
  const query = useQuery({
    queryKey: ['settings', businessPath('')],
    queryFn: () => request<Settings>(businessPath('/settings')),
  });
  return (
    <>
      <PageHeader title="تنظیمات" subtitle="پیکربندی عملیاتی کسب‌وکار" />
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <div className="notice">
              <span>ⓘ</span>
              <div>
                <strong>این تنظیمات توسط استقرار مدیریت می‌شوند</strong>
                <p>کلیدها و اعتبارنامه‌ها در پنل نمایش داده نمی‌شوند.</p>
              </div>
            </div>
            <Card>
              <div className="key-values">
                <KeyValue label="زبان رابط">فارسی</KeyValue>
                <KeyValue label="منطقه زمانی">تهران</KeyValue>
                <KeyValue label="مدت حالت انسانی">
                  {query.data.humanModeHours.toLocaleString('fa-IR')} ساعت
                </KeyValue>
                <KeyValue label="اعلان پیام‌های تکمیلی">
                  {query.data.notifyAdditionalMessages ? 'فعال' : 'غیرفعال'}
                </KeyValue>
                <KeyValue label="پیام تأیید ارجاع به مشتری">
                  {query.data.customerAcknowledgementEnabled ? 'فعال' : 'غیرفعال'}
                </KeyValue>
              </div>
            </Card>
          </>
        )}
      </QueryState>
    </>
  );
}
