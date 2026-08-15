import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../../app/SessionProvider';
import { Badge, Card, EmptyState, PageHeader, QueryState } from '../../components/ui';
import { request } from '../../core/api';
import { faLabel, formatDate } from '../../core/format';

interface AnalyticsOverview {
  totalProcessed: number;
  answersSent: number;
  handoffs: number;
  failedOrSuppressed: number;
  averageResponseTimeMs: number | null;
  averageRetrievalScore: number | null;
  tokens: { input: number; output: number; total: number };
  estimatedCostUsd: number | null;
}

interface TraceSummary {
  id: string;
  customerMessagePreview: string;
  decision: string | null;
  answerable: boolean | null;
  outcome: string;
  confidence: number | null;
  topRetrievalScore: number | null;
  latencyMs: number | null;
  createdAt: string;
}

interface TracePage {
  items: TraceSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface TraceChunk {
  rank?: number;
  chunkId?: string;
  knowledgeId?: string;
  title?: string;
  content?: string;
  score?: number;
  validated?: boolean;
  sentToAi?: boolean | null;
  citedByAi?: boolean;
  rejectionReason?: string | null;
}

interface TraceDetail {
  id: string;
  createdAt: string;
  completedAt: string | null;
  customerMessages: { id?: string; text?: string; sentAt?: string }[];
  conversationContext: { senderType?: string; text?: string; sentAt?: string }[] | null;
  retrieval: {
    raw: TraceChunk[];
    validated: TraceChunk[];
    sentToAi: TraceChunk[] | null;
    citedChunkIds: string[];
    chunks: TraceChunk[];
    latencyMs: number | null;
  };
  ai: {
    decision: string | null;
    answerable: boolean | null;
    confidence: number | null;
    reason: string | null;
    answer: string | null;
    model: string | null;
    promptVersion: string | null;
    tokens: { input: number | null; output: number | null; total: number | null };
    latencyMs: number;
  };
  outcome: {
    status: string;
    reason: string | null;
    errorCode: string | null;
    totalLatencyMs: number | null;
  };
  permissions: { canViewPromptInternals: boolean };
}

const outcomes = ['', 'SENT', 'HANDOFF', 'SUPPRESSED', 'WAITING', 'FAILED'];

function metric(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${Math.round(value).toLocaleString('fa-IR')}${suffix}`;
}

function score(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : `${(value * 100).toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪`;
}

function buildFilters(from: string, to: string, outcome: string, page?: number): string {
  const params = new URLSearchParams();
  if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());
  if (outcome) params.set('outcome', outcome);
  if (page) params.set('page', String(page));
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function AnalyticsPage() {
  const { businessPath } = useSession();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [outcome, setOutcome] = useState('');
  const [page, setPage] = useState(1);
  const filters = buildFilters(from, to, outcome);
  const overview = useQuery({
    queryKey: ['analytics-overview', businessPath(''), filters],
    queryFn: () => request<AnalyticsOverview>(businessPath(`/analytics/overview${filters}`)),
  });
  const traces = useQuery({
    queryKey: ['analytics-traces', businessPath(''), filters, page],
    queryFn: () =>
      request<TracePage>(businessPath(`/analytics/traces${buildFilters(from, to, outcome, page)}`)),
  });
  const pending = overview.isPending || traces.isPending;
  const error = overview.error ?? traces.error;

  return (
    <>
      <PageHeader
        title="تحلیل پاسخ‌های هوشمند"
        subtitle="مشاهده مسیر بازیابی، تصمیم و نتیجه نهایی هر پاسخ"
      />
      <div className="analytics-filters" aria-label="فیلتر تحلیل‌ها">
        <label>
          از تاریخ
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          تا تاریخ
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          نتیجه نهایی
          <select
            value={outcome}
            onChange={(event) => {
              setOutcome(event.target.value);
              setPage(1);
            }}
          >
            {outcomes.map((value) => (
              <option key={value} value={value}>
                {value ? faLabel(value) : 'همه نتایج'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryState pending={pending} error={error}>
        {overview.data && traces.data && (
          <>
            <div className="metric-grid analytics-metrics">
              <div className="metric">
                <span>◌</span>
                <strong>{metric(overview.data.totalProcessed)}</strong>
                <small>پیام پردازش‌شده</small>
              </div>
              <div className="metric">
                <span>✓</span>
                <strong>{metric(overview.data.answersSent)}</strong>
                <small>پاسخ ارسال‌شده</small>
              </div>
              <div className="metric">
                <span>⇢</span>
                <strong>{metric(overview.data.handoffs)}</strong>
                <small>ارجاع انسانی</small>
              </div>
              <div className="metric">
                <span>!</span>
                <strong>{metric(overview.data.failedOrSuppressed)}</strong>
                <small>ناموفق یا ارسال‌نشده</small>
              </div>
              <div className="metric">
                <span>◷</span>
                <strong>{metric(overview.data.averageResponseTimeMs, ' میلی‌ثانیه')}</strong>
                <small>میانگین زمان پاسخ</small>
              </div>
              <div className="metric">
                <span>≈</span>
                <strong>{score(overview.data.averageRetrievalScore)}</strong>
                <small>میانگین امتیاز بازیابی برتر</small>
              </div>
              <div className="metric">
                <span>▦</span>
                <strong>{metric(overview.data.tokens.total)}</strong>
                <small>مجموع توکن</small>
              </div>
              <div className="metric">
                <span>$</span>
                <strong>
                  {overview.data.estimatedCostUsd === null
                    ? 'پیکربندی نشده'
                    : overview.data.estimatedCostUsd.toLocaleString('fa-IR', {
                        maximumFractionDigits: 4,
                      })}
                </strong>
                <small>برآورد هزینه دلاری</small>
              </div>
            </div>
            <div className="section-head">
              <h3>ردیابی پیام‌ها</h3>
              <span className="muted">{metric(traces.data.total)} مورد</span>
            </div>
            <div className="list">
              {traces.data.items.length ? (
                traces.data.items.map((trace) => (
                  <Link
                    className="list-card trace-row"
                    to={`/analytics/traces/${trace.id}`}
                    key={trace.id}
                  >
                    <div className="list-main">
                      <strong>{trace.customerMessagePreview || 'پیام بدون متن'}</strong>
                      <span>
                        {formatDate(trace.createdAt)} · {faLabel(trace.decision)}
                      </span>
                    </div>
                    <div className="trace-summary">
                      <Badge status={trace.outcome}>{faLabel(trace.outcome)}</Badge>
                      <small>اطمینان {score(trace.confidence)}</small>
                      <small>بازیابی {score(trace.topRetrievalScore)}</small>
                      <small>{metric(trace.latencyMs, ' میلی‌ثانیه')}</small>
                    </div>
                  </Link>
                ))
              ) : (
                <EmptyState
                  icon="◌"
                  title="ردیابی‌ای پیدا نشد"
                  description="فیلترها را تغییر دهید یا منتظر پردازش پیام‌های جدید بمانید."
                />
              )}
            </div>
            {traces.data.totalPages > 1 && (
              <div className="pagination">
                <button
                  className="button"
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  صفحه قبل
                </button>
                <span>
                  صفحه {page.toLocaleString('fa-IR')} از{' '}
                  {traces.data.totalPages.toLocaleString('fa-IR')}
                </span>
                <button
                  className="button"
                  type="button"
                  disabled={page >= traces.data.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  صفحه بعد
                </button>
              </div>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}

function Messages({ items }: { items: { senderType?: string; text?: string; sentAt?: string }[] }) {
  return (
    <div className="trace-messages">
      {items.map((item, index) => (
        <article className="trace-message" key={`${item.sentAt ?? ''}-${index}`}>
          <header>
            <Badge status={item.senderType ?? 'CUSTOMER'}>{faLabel(item.senderType)}</Badge>
            {item.sentAt && <time>{formatDate(item.sentAt)}</time>}
          </header>
          <p>{item.text ?? 'بدون متن'}</p>
        </article>
      ))}
    </div>
  );
}

export function AnalyticsTracePage() {
  const { traceId } = useParams();
  const { businessPath } = useSession();
  const query = useQuery({
    queryKey: ['analytics-trace', businessPath(''), traceId],
    queryFn: () =>
      request<TraceDetail>(businessPath(`/analytics/traces/${encodeURIComponent(traceId ?? '')}`)),
    enabled: Boolean(traceId),
  });
  const trace = query.data;
  return (
    <QueryState pending={query.isPending} error={query.error}>
      {trace && (
        <>
          <PageHeader
            title="جزئیات ردیابی پاسخ"
            subtitle={formatDate(trace.createdAt)}
            actions={<Badge status={trace.outcome.status}>{faLabel(trace.outcome.status)}</Badge>}
          />
          <ol className="trace-timeline">
            <li>
              <Card title="۱. پیام مشتری">
                <Messages items={trace.customerMessages} />
              </Card>
            </li>
            <li>
              <Card title="۲. زمینه گفتگو">
                {trace.conversationContext ? (
                  trace.conversationContext.length ? (
                    <Messages items={trace.conversationContext} />
                  ) : (
                    <p className="muted">پیام پیشین مرتبطی ارسال نشده بود.</p>
                  )
                ) : (
                  <p className="permission-note">
                    جزئیات ورودی مدل فقط برای مالک و مدیر نمایش داده می‌شود.
                  </p>
                )}
              </Card>
            </li>
            <li>
              <Card title="۳. نتایج بازیابی دانش">
                <div className="stage-counts">
                  <span>خام از Qdrant: {trace.retrieval.raw.length.toLocaleString('fa-IR')}</span>
                  <span>
                    تأیید MySQL: {trace.retrieval.validated.length.toLocaleString('fa-IR')}
                  </span>
                  <span>
                    استناد مدل: {trace.retrieval.citedChunkIds.length.toLocaleString('fa-IR')}
                  </span>
                </div>
                <div className="retrieval-chunks">
                  {trace.retrieval.chunks.length ? (
                    trace.retrieval.chunks.map((chunk, index) => (
                      <details className="retrieval-chunk" key={chunk.chunkId ?? index}>
                        <summary>
                          <strong>
                            رتبه {(chunk.rank ?? index + 1).toLocaleString('fa-IR')} —{' '}
                            {chunk.title ?? 'دانش بدون عنوان'}
                          </strong>
                          <span className="ltr">{score(chunk.score)}</span>
                        </summary>
                        <div className="chunk-flags">
                          <Badge status={chunk.validated ? 'READY' : 'FAILED'}>
                            {chunk.validated ? 'تأیید MySQL' : 'رد MySQL'}
                          </Badge>
                          {chunk.sentToAi !== null && (
                            <Badge status={chunk.sentToAi ? 'READY' : 'NONE'}>
                              {chunk.sentToAi ? 'ارسال‌شده به مدل' : 'ارسال‌نشده به مدل'}
                            </Badge>
                          )}
                          <Badge status={chunk.citedByAi ? 'READY' : 'NONE'}>
                            {chunk.citedByAi ? 'استنادشده توسط مدل' : 'بدون استناد مدل'}
                          </Badge>
                        </div>
                        {chunk.rejectionReason && (
                          <p className="error-text">دلیل رد: {faLabel(chunk.rejectionReason)}</p>
                        )}
                        <p className="pre-wrap">{chunk.content}</p>
                        <small className="ltr technical-id">{chunk.chunkId}</small>
                      </details>
                    ))
                  ) : (
                    <p className="muted">نتیجه‌ای از Qdrant دریافت نشد.</p>
                  )}
                </div>
              </Card>
            </li>
            <li>
              <Card title="۴. داده‌های ارسال‌شده به هوش مصنوعی">
                {trace.retrieval.sentToAi ? (
                  <>
                    <p>
                      {trace.retrieval.sentToAi.length.toLocaleString('fa-IR')} قطعه تأییدشده به مدل
                      ارسال شد.
                    </p>
                    <details>
                      <summary>نمایش محتوای دقیق دانش ارسالی</summary>
                      {trace.retrieval.sentToAi.map((chunk, index) => (
                        <div className="chunk" key={chunk.chunkId ?? index}>
                          <strong>{chunk.title}</strong>
                          <p className="pre-wrap">{chunk.content}</p>
                        </div>
                      ))}
                    </details>
                  </>
                ) : (
                  <p className="permission-note">جزئیات ورودی مدل برای نقش پشتیبان پنهان است.</p>
                )}
              </Card>
            </li>
            <li>
              <Card title="۵. تصمیم و پاسخ هوش مصنوعی">
                <div className="key-values">
                  <div className="key-value">
                    <span>تصمیم</span>
                    <strong>{faLabel(trace.ai.decision)}</strong>
                  </div>
                  <div className="key-value">
                    <span>اطمینان</span>
                    <strong>{score(trace.ai.confidence)}</strong>
                  </div>
                  <div className="key-value">
                    <span>مدل</span>
                    <strong className="ltr">{trace.ai.model ?? 'ثبت نشده'}</strong>
                  </div>
                  <div className="key-value">
                    <span>نسخه پرامپت</span>
                    <strong className="ltr">{trace.ai.promptVersion ?? 'محدود'}</strong>
                  </div>
                  <div className="key-value">
                    <span>توکن ورودی / خروجی / کل</span>
                    <strong className="ltr">
                      {trace.ai.tokens.input ?? '—'} / {trace.ai.tokens.output ?? '—'} /{' '}
                      {trace.ai.tokens.total ?? '—'}
                    </strong>
                  </div>
                </div>
                {trace.ai.answer && (
                  <div className="answer-box">
                    <strong>پاسخ نهایی مدل</strong>
                    <p className="pre-wrap">{trace.ai.answer}</p>
                  </div>
                )}
                {trace.ai.reason && (
                  <details>
                    <summary>دلیل ساختاریافته مدل</summary>
                    <p>{trace.ai.reason}</p>
                  </details>
                )}
              </Card>
            </li>
            <li>
              <Card title="۶. نتیجه نهایی">
                <div className="key-values">
                  <div className="key-value">
                    <span>وضعیت</span>
                    <Badge status={trace.outcome.status}>{faLabel(trace.outcome.status)}</Badge>
                  </div>
                  <div className="key-value">
                    <span>دلیل</span>
                    <strong>{faLabel(trace.outcome.reason)}</strong>
                  </div>
                  <div className="key-value">
                    <span>زمان کل</span>
                    <strong>{metric(trace.outcome.totalLatencyMs, ' میلی‌ثانیه')}</strong>
                  </div>
                  {trace.outcome.errorCode && (
                    <div className="key-value">
                      <span>کد خطا</span>
                      <strong className="ltr">{trace.outcome.errorCode}</strong>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          </ol>
        </>
      )}
    </QueryState>
  );
}
