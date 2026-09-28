import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { request } from '../../core/api';
import { faLabel, formatDate, statusTone } from '../../core/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KeyValue,
  PageHeader,
  QueryState,
} from '../../components/ui';
import { useSession } from '../../app/SessionProvider';

export interface Connection {
  id?: string;
  businessConnectionId?: string;
  userChatId?: string;
  enabled: boolean;
  canReply: boolean;
  connectedAt: string | null;
  disabledAt: string | null;
  updatedAt: string;
  rights?: Record<string, unknown>;
}

export interface Health {
  ready: boolean;
  checks?: Record<string, boolean>;
  queues?: Record<string, { status: string; _count: number }[]>;
  credit?: {
    lastCheckedAt: string | null;
    isLow: boolean;
  };
  ai?: {
    availability: unknown;
    suppressions: Record<string, number>;
    settingsChanges: number;
  };
}

export interface Diagnostics {
  health: { ready: boolean; checks: Record<string, boolean> };
  queues?: {
    indexing: { status: string; _count: number }[];
    conversations: { status: string; _count: number }[];
  };
  logs: {
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
    topErrors: { errorCode: string; count: number; messageFa: string; fix?: string }[];
  } | null;
  generatedAt: string;
}

const checkNames: Record<string, string> = {
  process: 'فرآیند اصلی سرویس',
  configuration: 'پیکربندی محیطی',
  mysql: 'پایگاه داده (MySQL)',
  qdrant: 'موتور برداری دانش (Qdrant)',
  businessWebhook: 'دریافت پیام مشتری (وب‌هوک تجاری)',
  adminWebhook: 'ربات مدیریت (وب‌هوک ادمین)',
};

const queueNames: Record<string, string> = {
  indexing: 'پردازش و نمایه‌سازی دانش',
  conversations: 'صف پاسخ‌گویی به گفتگوها',
  notifications: 'ارسال اعلان‌های ادمین',
};

export function SystemHealthPage() {
  const { businessPath, hasCapability } = useSession();
  const canDiagnose = hasCapability('diagnostics:read');
  const [searchParams, setSearchParams] = useSearchParams();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const rawTab = searchParams.get('tab') ?? 'all';
  const activeTab = ['all', 'connections', 'services', 'diagnostics'].includes(rawTab)
    ? rawTab
    : 'all';

  const setTab = (tab: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === 'all') next.delete('tab');
        else next.set('tab', tab);
        return next;
      },
      { replace: true },
    );
  };

  const systemQuery = useQuery<Health>({
    queryKey: ['system', businessPath('')],
    queryFn: () => request<Health>(businessPath('/system')),
    refetchInterval: 20_000,
  });

  const connectionsQuery = useQuery<Connection[]>({
    queryKey: ['connections', businessPath('')],
    queryFn: () => request<Connection[]>(businessPath('/connections')),
    refetchInterval: 20_000,
  });

  const diagnosticsQuery = useQuery<Diagnostics>({
    queryKey: ['diagnostics', businessPath('')],
    queryFn: () => request<Diagnostics>(businessPath('/diagnostics')),
    enabled: canDiagnose,
    refetchInterval: 20_000,
  });

  const isPending =
    systemQuery.isPending ||
    connectionsQuery.isPending ||
    (canDiagnose && diagnosticsQuery.isPending);
  const error =
    systemQuery.error ?? connectionsQuery.error ?? (canDiagnose ? diagnosticsQuery.error : null);

  const health = systemQuery.data;
  const connections = connectionsQuery.data ?? [];
  const diagnostics = diagnosticsQuery.data;

  const hasActiveConnection = connections.some((c) => c.enabled && c.canReply);
  const checks = health?.checks ?? diagnostics?.health.checks ?? {};
  const checkEntries = Object.entries(checks);
  const healthyChecksCount = checkEntries.filter(([, v]) => v).length;
  const totalChecksCount = checkEntries.length;

  // Active queue items count
  const queues = health?.queues ?? (diagnostics?.queues as Health['queues']) ?? {};
  let totalActiveQueueJobs = 0;
  Object.values(queues).forEach((groups) => {
    groups.forEach((g) => {
      if (['PENDING', 'PROCESSING', 'INDEXING', 'RETRY'].includes(g.status)) {
        totalActiveQueueJobs += g._count;
      }
    });
  });

  // Recent errors
  const topErrors = diagnostics?.logs?.topErrors ?? [];
  const totalRecentErrors = topErrors.reduce((sum, e) => sum + e.count, 0);

  const isOverallReady =
    Boolean(health?.ready ?? diagnostics?.health.ready) &&
    (connections.length === 0 || hasActiveConnection);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        systemQuery.refetch(),
        connectionsQuery.refetch(),
        canDiagnose ? diagnosticsQuery.refetch() : Promise.resolve(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="سلامت و عیب‌یابی سامانه"
        subtitle={
          isOverallReady
            ? 'سرویس‌های هسته، اتصال تجاری تلگرام و صف‌ها در وضعیت مطلوب هستند.'
            : 'یک یا چند سرویس یا اتصال تجاری نیازمند بررسی است.'
        }
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              variant="default"
              type="button"
              disabled={isRefreshing}
              onClick={handleRefresh}
              aria-label="به‌روزرسانی داده‌ها"
            >
              {isRefreshing ? 'در حال دریافت…' : '↻ به‌روزرسانی'}
            </Button>
            {canDiagnose && (
              <Link
                to="/logs"
                className="button"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span aria-hidden="true">≡</span>
                <span>لاگ‌های سامانه</span>
              </Link>
            )}
          </div>
        }
      />

      <QueryState pending={isPending} error={error}>
        {/* Status Notice Banner */}
        <div className={`notice ${isOverallReady ? '' : 'error'}`}>
          <span aria-hidden="true">{isOverallReady ? '✓' : '!'}</span>
          <div>
            <strong>
              {isOverallReady
                ? 'سامانه و اتصال تجاری آماده پاسخ‌گویی است'
                : 'سامانه یا اتصال تجاری نیازمند بررسی است'}
            </strong>
            <p>
              {isOverallReady
                ? 'تمام وب‌هوک‌ها، صف‌های پردازش و پایگاه‌های داده بدون اختلال گزارش شده‌اند.'
                : !hasActiveConnection && connections.length > 0
                  ? 'اتصال تجاری تلگرام متصل نیست یا دسترسی پاسخ‌گویی به آن داده نشده است.'
                  : 'یک یا چند سرویس اصلی با خطا مواجه شده‌اند. جزئیات زیر را بررسی کنید.'}
            </p>
          </div>
        </div>

        {/* Quick KPI Metrics */}
        <div className="metric-grid">
          <div className="metric">
            <span aria-hidden="true">⌁</span>
            <strong>
              {hasActiveConnection ? 'آماده' : connections.length ? 'نیازمند بررسی' : 'بدون اتصال'}
            </strong>
            <small>اتصال تلگرام بیزینس</small>
          </div>
          <div className="metric">
            <span aria-hidden="true">♡</span>
            <strong>
              {totalChecksCount > 0
                ? `${healthyChecksCount.toLocaleString('fa-IR')} از ${totalChecksCount.toLocaleString('fa-IR')}`
                : '—'}
            </strong>
            <small>سرویس‌های فعال</small>
          </div>
          <div className="metric">
            <span aria-hidden="true">◷</span>
            <strong>{totalActiveQueueJobs.toLocaleString('fa-IR')}</strong>
            <small>کارهای در صف</small>
          </div>
          {canDiagnose && (
            <div className="metric">
              <span aria-hidden="true">!</span>
              <strong>{totalRecentErrors.toLocaleString('fa-IR')}</strong>
              <small>خطای ۲۴ ساعت گذشته</small>
            </div>
          )}
        </div>

        {/* Segmented Filter Navigation */}
        <div className="filters" role="tablist" aria-label="بخش‌های سلامت و عیب‌یابی">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            className={`chip ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setTab('all')}
          >
            نمای کلی و جامع
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'connections'}
            className={`chip ${activeTab === 'connections' ? 'active' : ''}`}
            onClick={() => setTab('connections')}
          >
            اتصال تجاری{' '}
            {connections.length ? `(${connections.length.toLocaleString('fa-IR')})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'services'}
            className={`chip ${activeTab === 'services' ? 'active' : ''}`}
            onClick={() => setTab('services')}
          >
            سرویس‌ها و صف‌ها
          </button>
          {canDiagnose && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'diagnostics'}
              className={`chip ${activeTab === 'diagnostics' ? 'active' : ''}`}
              onClick={() => setTab('diagnostics')}
            >
              عیب‌یابی و لاگ‌ها{' '}
              {topErrors.length ? `(${topErrors.length.toLocaleString('fa-IR')})` : ''}
            </button>
          )}
        </div>

        {/* SECTION 1: BUSINESS CONNECTION */}
        {(activeTab === 'all' || activeTab === 'connections') && (
          <section aria-labelledby="section-connection-heading">
            <div className="section-head">
              <h3 id="section-connection-heading">اتصال حساب تجاری تلگرام</h3>
              {activeTab === 'all' && (
                <button
                  type="button"
                  className="button"
                  style={{ fontSize: '0.82rem' }}
                  onClick={() => setTab('connections')}
                >
                  مشاهده تمام جزئیات اتصال
                </button>
              )}
            </div>

            {connections.length ? (
              <div className="grid">
                {connections.map((item, index) => (
                  <Card key={item.id ?? index}>
                    <div className="page-head" style={{ marginBottom: 12 }}>
                      <h3>حساب تجاری تلگرام</h3>
                      <Badge status={item.enabled && item.canReply ? 'READY' : 'ATTENTION'}>
                        {item.enabled && item.canReply ? 'آماده پاسخ‌گویی' : 'نیازمند بررسی'}
                      </Badge>
                    </div>
                    <div className="key-values">
                      <KeyValue label="وضعیت ارتباط">{item.enabled ? 'فعال' : 'غیرفعال'}</KeyValue>
                      <KeyValue label="اجازه پاسخ‌گویی مستقیم">
                        {item.canReply ? 'دارد' : 'ندارد'}
                      </KeyValue>
                      {item.connectedAt && (
                        <KeyValue label="تاریخ اتصال">{formatDate(item.connectedAt)}</KeyValue>
                      )}
                      <KeyValue label="آخرین به‌روزرسانی">{formatDate(item.updatedAt)}</KeyValue>
                      {item.businessConnectionId && (
                        <KeyValue label="شناسه اتصال">
                          <span className="ltr" style={{ fontSize: '0.85rem' }}>
                            {item.businessConnectionId}
                          </span>
                        </KeyValue>
                      )}
                    </div>
                    {(!item.enabled || !item.canReply) && (
                      <div className="notice error" style={{ marginTop: 14 }}>
                        <span aria-hidden="true">!</span>
                        <div>
                          <strong>پاسخ‌گویی خودکار متوقف است</strong>
                          <p>
                            در بخش تنظیمات تلگرام (Telegram Business &gt; Chatbots)، دسترسی پاسخ به
                            پیام‌ها را برای ربات فعال نمایید.
                          </p>
                        </div>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="⌁"
                title="اتصال تجاری ثبت نشده است"
                description="ربات پشتیبانی هنوز به هیچ حساب تلگرام بیزینسی متصل نشده است. از تنظیمات تلگرام ربات را به عنوان Chatbot متصل فرمایید."
              />
            )}
          </section>
        )}

        {/* SECTION 2: SERVICES & QUEUES */}
        {(activeTab === 'all' || activeTab === 'services') && (
          <section aria-labelledby="section-services-heading">
            <div className="section-head">
              <h3 id="section-services-heading">سرویس‌های اصلی و صف‌های پردازش</h3>
              {activeTab === 'all' && (
                <button
                  type="button"
                  className="button"
                  style={{ fontSize: '0.82rem' }}
                  onClick={() => setTab('services')}
                >
                  پایش صف‌ها
                </button>
              )}
            </div>

            <div className="split-grid">
              {/* Services Check Card */}
              <Card title="بررسی سلامت زیرساخت و سرویس‌ها">
                <div className="key-values">
                  {checkEntries.length ? (
                    checkEntries.map(([key, value]) => (
                      <KeyValue key={key} label={checkNames[key] ?? key}>
                        <Badge status={value ? 'READY' : 'FAILED'}>
                          {value ? 'سالم' : 'نیازمند بررسی'}
                        </Badge>
                      </KeyValue>
                    ))
                  ) : (
                    <p className="muted">
                      وضعیت کلی سرویس‌ها بر اساس سطح دسترسی شما نمایش داده شده است.
                    </p>
                  )}
                </div>
              </Card>

              {/* Queues Card */}
              <Card title="وضعیت صف‌های پردازش پس‌زمینه">
                {Object.keys(queues).length ? (
                  Object.entries(queues).map(([name, groups]) => (
                    <details key={name} open={activeTab === 'services'}>
                      <summary style={{ cursor: 'pointer', padding: '6px 0', fontWeight: 600 }}>
                        {queueNames[name] ?? name}
                        <span className="muted" style={{ marginRight: 8, fontSize: '0.85rem' }}>
                          ({groups.reduce((acc, g) => acc + g._count, 0).toLocaleString('fa-IR')}{' '}
                          رکورد)
                        </span>
                      </summary>
                      <div
                        className="key-values"
                        style={{ paddingRight: 12, marginTop: 6, marginBottom: 12 }}
                      >
                        {groups.length ? (
                          groups.map((group) => (
                            <KeyValue key={group.status} label={faLabel(group.status)}>
                              <span className="ltr">{group._count.toLocaleString('fa-IR')}</span>
                            </KeyValue>
                          ))
                        ) : (
                          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                            صف خالی است.
                          </p>
                        )}
                      </div>
                    </details>
                  ))
                ) : (
                  <p className="muted">اطلاعات صف‌ها در دسترس نیست یا صف‌ها خالی هستند.</p>
                )}
              </Card>
            </div>

            {/* Credit Monitor Notice if available */}
            {health?.credit && (
              <div style={{ marginTop: 16 }}>
                <Card title="اعتبار سرویس مدل زبانی (NanoGPT)">
                  <div className="key-values">
                    <KeyValue label="وضعیت موجودی اعتبار">
                      <Badge status={health.credit.isLow ? 'ATTENTION' : 'READY'}>
                        {health.credit.isLow ? 'موجودی اندک (نیاز به شارژ)' : 'مطلوب'}
                      </Badge>
                    </KeyValue>
                    {health.credit.lastCheckedAt && (
                      <KeyValue label="آخرین استعلام اعتبار">
                        {formatDate(health.credit.lastCheckedAt)}
                      </KeyValue>
                    )}
                  </div>
                </Card>
              </div>
            )}
          </section>
        )}

        {/* SECTION 3: DIAGNOSTICS & LOGS (Gated by canDiagnose) */}
        {canDiagnose && (activeTab === 'all' || activeTab === 'diagnostics') && (
          <section aria-labelledby="section-diagnostics-heading">
            <div className="section-head">
              <h3 id="section-diagnostics-heading">عیب‌یابی پیشرفته و تحلیل خطاها</h3>
              <Link to="/logs" className="button" style={{ fontSize: '0.82rem' }}>
                مشاهده فیلتر لاگ‌ها
              </Link>
            </div>

            {/* Top Errors Card */}
            {topErrors.length > 0 ? (
              <Card title="خطاهای پرتکرار ۲۴ ساعت گذشته">
                <div style={{ display: 'grid', gap: 12 }}>
                  {topErrors.map((e) => (
                    <div
                      key={e.errorCode}
                      className="key-value"
                      style={{
                        alignItems: 'flex-start',
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'var(--surface-soft)',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div
                          style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}
                        >
                          <span className="badge neutral ltr" style={{ fontWeight: 700 }}>
                            {e.errorCode}
                          </span>
                          <strong style={{ fontSize: '0.92rem' }}>{e.messageFa}</strong>
                        </div>
                        {e.fix && (
                          <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>
                            راهکار رفع: {e.fix}
                          </div>
                        )}
                      </div>
                      <Badge status="FAILED">
                        <span className="ltr">×{e.count.toLocaleString('fa-IR')}</span>
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card title="خطاهای پرتکرار ۲۴ ساعت گذشته">
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success)' }}
                >
                  <span>✓</span>
                  <span>هیچ خطای تکرارشونده‌ای در ۲۴ ساعت گذشته ثبت نشده است.</span>
                </div>
              </Card>
            )}

            {/* Log Distribution Cards */}
            {diagnostics?.logs && (
              <div className="split-grid" style={{ marginTop: 16 }}>
                <Card title="توزیع سطوح لاگ (۲۴ ساعت)">
                  <div className="key-values">
                    {Object.entries(diagnostics.logs.byLevel).map(([level, count]) => (
                      <KeyValue key={level} label={level}>
                        <Badge
                          status={
                            ['ERROR', 'FATAL'].includes(level)
                              ? 'FAILED'
                              : level === 'WARN'
                                ? 'RETRY'
                                : 'READY'
                          }
                        >
                          <span className="ltr">{count.toLocaleString('fa-IR')}</span>
                        </Badge>
                      </KeyValue>
                    ))}
                    {!Object.keys(diagnostics.logs.byLevel).length && (
                      <p className="muted">لاگی ثبت نشده است.</p>
                    )}
                  </div>
                </Card>

                <Card title="توزیع دسته‌بندی لاگ‌ها">
                  <div className="key-values">
                    {Object.entries(diagnostics.logs.byCategory).map(([category, count]) => (
                      <KeyValue key={category} label={category}>
                        <Badge status={statusTone(category)}>
                          <span className="ltr">{count.toLocaleString('fa-IR')}</span>
                        </Badge>
                      </KeyValue>
                    ))}
                    {!Object.keys(diagnostics.logs.byCategory).length && (
                      <p className="muted">دسته‌ای گزارش نشده است.</p>
                    )}
                  </div>
                </Card>
              </div>
            )}
          </section>
        )}
      </QueryState>
    </>
  );
}

// Backward-compatible alias exports
export { SystemHealthPage as SystemPage };
export { SystemHealthPage as ConnectionsPage };
export { SystemHealthPage as DiagnosticsPage };
