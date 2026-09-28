import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '../../core/api';
import { formatDate, statusTone } from '../../core/format';
import { Badge, Card, EmptyState, PageHeader, QueryState } from '../../components/ui';
import { useSession } from '../../app/SessionProvider';
interface R {
  id: string;
  level: string;
  category: string;
  message: string;
  messageFa: string;
  errorCode: string | null;
  count: number;
  metadata: unknown;
  createdAt: string;
}
interface P {
  items: R[];
  total: number;
  page: number;
  totalPages: number;
}
const levels = ['', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'FATAL'] as const;
const cats = [
  '',
  'WEBHOOK',
  'TELEGRAM',
  'AI',
  'WORKER',
  'QDRANT',
  'INDEXING',
  'CREDIT',
  'HTTP',
  'DATABASE',
  'SYSTEM',
  'AUTH',
  'HANDOFF',
] as const;
export function LogsPage() {
  const { businessPath } = useSession();
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [si, setSi] = useState('');
  const [page, setPage] = useState(1);
  const [timeFrom, setTimeFrom] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const params = useMemo(() => {
    const p: Record<string, string> = { page: String(page), pageSize: '20' };
    if (level) p.level = level;
    if (category) p.category = category;
    if (search) p.search = search;
    if (timeFrom) p.from = timeFrom;
    return p;
  }, [level, category, search, timeFrom, page]);
  const query = useQuery<P>({
    queryKey: ['system-logs', businessPath(''), params],
    queryFn: () => {
      const usp = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v) usp.set(k, v);
      });
      const qs = usp.toString();
      return request<P>(businessPath('/system-logs' + (qs ? '?' + qs : '')));
    },
    refetchInterval: autoRefresh ? 10000 : false,
  });
  const onSearch = () => {
    setSearch(si.trim());
    setPage(1);
  };
  return (
    <>
      <PageHeader
        title="لاگ سامانه"
        subtitle={query.data ? String(query.data.total) + ' رویداد' : 'رویدادها'}
        actions={
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />{' '}
            بروزرسانی
          </label>
        }
      />
      <Card>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={level}
              onChange={(e) => {
                setLevel(e.target.value);
                setPage(1);
              }}
              className="business-select"
              style={{ minHeight: 38 }}
            >
              <option value="">همه سطوح</option>
              {levels.filter(Boolean).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              className="business-select"
              style={{ minHeight: 38 }}
            >
              <option value="">همه دسته‌ها</option>
              {cats.filter(Boolean).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={timeFrom ? 'custom' : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__24h')
                  setTimeFrom(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
                else if (v === '__7d')
                  setTimeFrom(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
                else if (v === '') setTimeFrom('');
                setPage(1);
              }}
              className="business-select"
              style={{ minHeight: 38 }}
            >
              <option value="">همه زمان‌ها</option>
              <option value="__24h">24 ساعت</option>
              <option value="__7d">7 روز</option>
            </select>
            {timeFrom && (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setTimeFrom('');
                  setPage(1);
                }}
              >
                پاک
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="search-input"
              placeholder="جستجو"
              value={si}
              onChange={(e) => setSi(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSearch();
                }
              }}
              style={{ flex: 1 }}
            />
            <button className="button primary" type="button" onClick={onSearch}>
              جستجو
            </button>
            {(search || level || category) && (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setLevel('');
                  setCategory('');
                  setSearch('');
                  setSi('');
                  setTimeFrom('');
                  setPage(1);
                }}
              >
                پاک
              </button>
            )}
          </div>
        </div>
      </Card>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <div className="list">
              {query.data.items.length ? (
                query.data.items.map((item) => (
                  <article
                    key={item.id}
                    className="list-card"
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 10,
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <div
                        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
                      >
                        <Badge
                          status={
                            item.level === 'ERROR' || item.level === 'FATAL'
                              ? 'FAILED'
                              : item.level === 'WARN'
                                ? 'RETRY'
                                : 'READY'
                          }
                        >
                          {item.level}
                        </Badge>
                        <Badge status={statusTone(item.category)}>{item.category}</Badge>
                        {item.errorCode && (
                          <span className="badge neutral ltr">{item.errorCode}</span>
                        )}
                        {item.count > 1 && <span className="badge warning">x{item.count}</span>}
                      </div>
                      <time style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                        {formatDate(item.createdAt, true)}
                      </time>
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.95rem' }}>
                        {item.messageFa}
                      </strong>
                      <small className="muted ltr" style={{ wordBreak: 'break-all' }}>
                        {item.message}
                      </small>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="button"
                        type="button"
                        onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                      >
                        {expanded === item.id ? 'بستن' : 'جزئیات'}
                      </button>
                    </div>
                    {expanded === item.id && (
                      <pre
                        style={{
                          margin: 0,
                          padding: 12,
                          background: 'var(--surface-soft)',
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          overflow: 'auto',
                          fontSize: '0.78rem',
                          direction: 'ltr',
                          textAlign: 'left',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {JSON.stringify({ id: item.id, metadata: item.metadata }, null, 2)}
                      </pre>
                    )}
                  </article>
                ))
              ) : (
                <EmptyState icon="✓" title="لاگی نیست" description="فیلتر را عوض کنید." />
              )}
            </div>
            <div className="pagination">
              <button
                className="button"
                disabled={query.data.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                قبلی
              </button>
              <span className="muted">
                صفحه {query.data.page} از {query.data.totalPages}
              </span>
              <button
                className="button"
                disabled={query.data.page >= query.data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                بعدی
              </button>
            </div>
          </>
        )}{' '}
      </QueryState>
    </>
  );
}
