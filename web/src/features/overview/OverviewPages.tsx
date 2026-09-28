import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { request } from '../../core/api';
import { faLabel, formatDate } from '../../core/format';
import type { HandoffSummary } from '../../core/types';
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
          <PageHeader title="نمای کلی" subtitle="داشبورد عملیاتی و وضعیت سامانه" />
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

export {
  SystemHealthPage as SystemPage,
  SystemHealthPage as ConnectionsPage,
} from '../system/SystemHealthPage';

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
