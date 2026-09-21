import { useQuery } from '@tanstack/react-query';
import { request } from '../../core/api';
import { faLabel } from '../../core/format';
import { Badge, Card, KeyValue, PageHeader, QueryState } from '../../components/ui';
import { useSession } from '../../app/SessionProvider';

interface Diagnostics {
  health: { ready: boolean; checks: Record<string, boolean> };
  queues?: { indexing: { status: string; _count: number }[]; conversations: { status: string; _count: number }[] };
  logs: { byLevel: Record<string, number>; byCategory: Record<string, number>; topErrors: { errorCode: string; count: number; messageFa: string; fix?: string }[] } | null;
  generatedAt: string;
}
const checkNames: Record<string, string> = {
  process: 'فرآیند',
  configuration: 'پیکربندی',
  mysql: 'MySQL',
  qdrant: 'Qdrant',
  businessWebhook: 'وب‌هوک تجاری',
  adminWebhook: 'وب‌هوک مدیریت',
};

export function DiagnosticsPage() {
  const { businessPath } = useSession();
  const q = useQuery<Diagnostics>({
    queryKey: ['diagnostics', businessPath('')],
    queryFn: () => request<Diagnostics>(businessPath('/diagnostics')),
    refetchInterval: 20000,
  });
  const d = q.data;
  return (
    <>
      <PageHeader title="عیب‌یابی سامانه" subtitle={d ? (d.health.ready ? 'همه سرویس‌ها سالم' : 'نیاز به بررسی') : 'سلامت و لاگ‌ها'} />
      <QueryState pending={q.isPending} error={q.error}>
        {d && (
          <>
            <div className={`notice ${d.health.ready ? '' : 'error'}`}>
              <span>{d.health.ready ? '✓' : '!'}</span>
              <div>
                <strong>{d.health.ready ? 'سامانه آماده است' : 'سامانه نیاز به بررسی دارد'}</strong>
                <p>{d.health.ready ? 'سرویس‌های اصلی بدون اختلال.' : 'یک یا چند سرویس نامطلوب است.'}</p>
              </div>
            </div>
            {(d.logs?.topErrors?.length ?? 0) > 0 && (
              <Card title="خطاهای پرتکرار ۲۴ ساعت">
                {d.logs!.topErrors.map((e) => (
                  <div key={e.errorCode} className="key-value" style={{ alignItems: 'flex-start' as const }}>
                    <span>
                      <strong className="ltr">{e.errorCode}</strong> — {e.messageFa}
                      <br />
                      <small className="muted">{e.fix ?? ''}</small>
                    </span>
                    <strong className="ltr">×{e.count.toLocaleString('fa-IR')}</strong>
                  </div>
                ))}
              </Card>
            )}
            <div className="split-grid">
              <Card title="بررسی سرویس‌ها">
                <div className="key-values">
                  {Object.entries(d.health.checks).map(([key, value]) => (
                    <KeyValue key={key} label={checkNames[key] ?? key}>
                      <Badge status={value ? 'READY' : 'FAILED'}>{value ? 'سالم' : 'نیازمند بررسی'}</Badge>
                    </KeyValue>
                  ))}
                </div>
              </Card>
              {d.queues && (
                <Card title="صف‌ها">
                  {Object.entries(d.queues).map(([name, groups]) => (
                    <details key={name}>
                      <summary>{name === 'indexing' ? 'پردازش دانش' : 'پاسخ‌گویی'}</summary>
                      {groups.map((g) => (
                        <KeyValue key={g.status} label={faLabel(g.status)}>
                          {g._count.toLocaleString('fa-IR')}
                        </KeyValue>
                      ))}
                    </details>
                  ))}
                </Card>
              )}
            </div>
            {d.logs && (
              <div className="split-grid">
                <Card title="سطح لاگ‌ها">
                  <div className="key-values">
                    {Object.entries(d.logs.byLevel).map(([k, v]) => (
                      <KeyValue key={k} label={k}>
                        <Badge status={k === 'ERROR' || k === 'FATAL' ? 'FAILED' : k === 'WARN' ? 'RETRY' : 'READY'}>
                          {v.toLocaleString('fa-IR')}
                        </Badge>
                      </KeyValue>
                    ))}
                    {!Object.keys(d.logs.byLevel).length && <p className="muted">لاگی ثبت نشده.</p>}
                  </div>
                </Card>
                <Card title="دسته‌ها">
                  <div className="key-values">
                    {Object.entries(d.logs.byCategory).map(([k, v]) => (
                      <KeyValue key={k} label={k}>
                        {v.toLocaleString('fa-IR')}
                      </KeyValue>
                    ))}
                    {!Object.keys(d.logs.byCategory).length && <p className="muted">—</p>}
                  </div>
                </Card>
              </div>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}
