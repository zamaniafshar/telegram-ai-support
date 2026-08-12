import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { request, jsonBody } from '../../core/api';
import { faLabel, formatDate, outcomeLabels } from '../../core/format';
import type {
  ConversationDetail,
  ConversationSummary,
  HandoffDetail,
  HandoffSummary,
  Message,
} from '../../core/types';
import { telegram } from '../../core/telegram';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  KeyValue,
  PageHeader,
  QueryState,
  SearchForm,
} from '../../components/ui';
import { useSession } from '../../app/SessionProvider';
import { useToast } from '../../app/ToastProvider';

function MessageTimeline({ messages }: { messages: Message[] }) {
  if (!messages.length)
    return (
      <EmptyState
        icon="◌"
        title="پیامی موجود نیست"
        description="متن قابل نمایشی برای این گفتگو ثبت نشده است."
      />
    );
  return (
    <div className="timeline">
      {messages.map((message) => (
        <article
          className={`message ${message.senderType === 'CUSTOMER' ? '' : 'outgoing'}`}
          key={message.id}
        >
          <div className="message-head">
            <span>{message.senderType === 'HUMAN' ? 'پشتیبان' : faLabel(message.senderType)}</span>
            <time>{formatDate(message.sentAt)}</time>
          </div>
          <p dir="auto">{message.text ?? 'پیام غیرمتنی یا حذف‌شده'}</p>
        </article>
      ))}
    </div>
  );
}

function Filters({
  name,
  value,
  options,
}: {
  name: string;
  value: string;
  options: [string, string][];
}) {
  const [params, setParams] = useSearchParams();
  return (
    <div className="filters" role="group" aria-label="فیلتر">
      {options.map(([key, label]) => (
        <Button
          key={key}
          className={`chip ${value === key ? 'active' : ''}`}
          onClick={() => {
            if (key) params.set(name, key);
            else params.delete(name);
            setParams(params);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

export function HandoffsPage() {
  const { businessPath } = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const search = params.get('query') ?? '';
  const query = useQuery({
    queryKey: ['handoffs', businessPath(''), status, search],
    queryFn: () =>
      request<HandoffSummary[]>(
        `${businessPath('/handoffs')}?${new URLSearchParams({ ...(status && { status }), ...(search && { query: search }) })}`,
      ),
  });
  return (
    <>
      <PageHeader
        title="ارجاع‌ها"
        subtitle={
          query.data
            ? `${query.data.length.toLocaleString('fa-IR')} مورد`
            : 'پیام‌های نیازمند رسیدگی انسانی'
        }
      />
      <SearchForm
        initialValue={search}
        placeholder="جستجوی نام یا نام کاربری مشتری"
        onSearch={(value) => {
          if (value) params.set('query', value);
          else params.delete('query');
          setParams(params);
        }}
      />
      <Filters
        name="status"
        value={status}
        options={[
          ['', 'همه'],
          ['WAITING', 'در انتظار'],
          ['ACKNOWLEDGED', 'پذیرفته‌شده'],
          ['RESOLVED', 'حل‌شده'],
        ]}
      />
      <QueryState pending={query.isPending} error={query.error}>
        <div className="list spaced">
          {query.data?.length ? (
            query.data.map((item) => (
              <Link className="list-card" to={`/handoffs/${item.conversationId}`} key={item.id}>
                <div className="list-main">
                  <strong>{item.customer.name}</strong>
                  <span>{faLabel(item.reasonCode)}</span>
                </div>
                <div className="list-meta">
                  <Badge status={item.status} />
                  <time>{formatDate(item.startedAt, true)}</time>
                </div>
              </Link>
            ))
          ) : (
            <EmptyState title="ارجاعی یافت نشد" description="پیامی منتظر رسیدگی انسانی نیست." />
          )}
        </div>
      </QueryState>
    </>
  );
}

const resolutionSchema = z.object({ outcome: z.string().min(1), note: z.string().max(2000) });

export function HandoffDetailPage() {
  const { conversationId = '' } = useParams();
  const { businessPath } = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const [resolveOpen, setResolveOpen] = useState(false);
  const queryKey = ['handoff', businessPath(''), conversationId];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      request<HandoffDetail>(businessPath(`/handoffs/${encodeURIComponent(conversationId)}`)),
  });
  const action = useMutation({
    mutationFn: ({ name, body }: { name: string; body?: unknown }) =>
      request(businessPath(`/handoffs/${encodeURIComponent(conversationId)}/${name}`), {
        method: 'POST',
        ...(body === undefined ? {} : { body: jsonBody(body) }),
      }),
    onSuccess: async () => {
      toast('تغییر با موفقیت ثبت شد.');
      await client.invalidateQueries({ queryKey });
    },
  });
  const detail = query.data;
  const act = (name: string, confirm?: string) => {
    if (!confirm || window.confirm(confirm)) action.mutate({ name });
  };
  const openChat = () => {
    const username = detail?.customer.username;
    if (!username) {
      toast('برای این مشتری لینک مستقیم قابل اتکا نیست.', 'warning');
      return;
    }
    const url = `https://t.me/${username}`;
    if (telegram?.openTelegramLink) telegram.openTelegramLink(url);
    else window.location.assign(url);
  };
  return (
    <QueryState pending={query.isPending} error={query.error}>
      {detail && (
        <>
          <PageHeader title="جزئیات ارجاع" subtitle="زمینه اخیر و اقدامات انسانی" />
          <section className="detail-hero">
            <Badge status={detail.activeHandoff?.status ?? detail.mode} />
            <h2>{detail.customer.name}</h2>
            <p>
              {detail.customer.username ? `@${detail.customer.username}` : 'بدون نام کاربری عمومی'}
            </p>
          </section>
          <div className="split-grid">
            <section>
              <Card>
                <div className="button-row">
                  {detail.capabilities.canClaim && (
                    <Button variant="primary" onClick={() => act('claim')}>
                      پذیرفتن ارجاع
                    </Button>
                  )}
                  {detail.capabilities.canAcknowledge && (
                    <Button onClick={() => act('acknowledge')}>مشاهده شد</Button>
                  )}
                  {detail.capabilities.canExtend && (
                    <Button onClick={() => act('extend', 'حالت انسانی از اکنون تمدید شود؟')}>
                      تمدید حالت انسانی
                    </Button>
                  )}
                  {detail.capabilities.canResolve && (
                    <Button variant="primary" onClick={() => setResolveOpen(true)}>
                      حل ارجاع
                    </Button>
                  )}
                  {detail.capabilities.canEnableAi && (
                    <Button onClick={() => act('enable-ai', 'پاسخ‌گویی هوشمند فعال شود؟')}>
                      فعال‌سازی پاسخ‌گویی هوشمند
                    </Button>
                  )}
                  <Button onClick={openChat}>باز کردن گفتگوی مشتری</Button>
                </div>
              </Card>
              <h3 className="section-title">پیام‌های اخیر</h3>
              <MessageTimeline messages={detail.messages} />
            </section>
            <aside>
              <Card title="وضعیت ارجاع">
                <div className="key-values">
                  <KeyValue label="حالت گفتگو">{faLabel(detail.mode)}</KeyValue>
                  <KeyValue label="دلیل ارجاع">
                    {faLabel(detail.activeHandoff?.reasonCode)}
                  </KeyValue>
                  <KeyValue label="پایان حالت انسانی">
                    {formatDate(detail.humanModeExpiresAt)}
                  </KeyValue>
                  <KeyValue label="پنجره پاسخ تلگرام">
                    {formatDate(detail.replyWindowExpiresAt)}
                  </KeyValue>
                  <KeyValue label="شناسه تلگرام">
                    <bdi className="ltr">{detail.customer.telegramUserId}</bdi>
                  </KeyValue>
                </div>
              </Card>
            </aside>
          </div>
          {resolveOpen && (
            <Dialog
              title="حل ارجاع"
              description="نتیجه رسیدگی را ثبت کنید. پاسخ‌گویی هوشمند دوباره فعال می‌شود."
              onClose={() => setResolveOpen(false)}
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const value = resolutionSchema.parse({
                    outcome: form.get('outcome'),
                    note: form.get('note'),
                  });
                  action.mutate(
                    { name: 'resolve', body: { ...value, note: value.note || undefined } },
                    { onSuccess: () => setResolveOpen(false) },
                  );
                }}
              >
                <label className="field">
                  نتیجه
                  <select name="outcome">
                    {Object.entries(outcomeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  یادداشت اختیاری
                  <textarea name="note" maxLength={2000} />
                </label>
                <div className="button-row">
                  <Button type="button" onClick={() => setResolveOpen(false)}>
                    انصراف
                  </Button>
                  <Button type="submit" variant="primary">
                    ثبت و حل ارجاع
                  </Button>
                </div>
              </form>
            </Dialog>
          )}
        </>
      )}
    </QueryState>
  );
}

export function ConversationsPage() {
  const { businessPath } = useSession();
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') ?? '';
  const search = params.get('query') ?? '';
  const query = useQuery({
    queryKey: ['conversations', businessPath(''), mode, search],
    queryFn: () =>
      request<ConversationSummary[]>(
        `${businessPath('/conversations')}?${new URLSearchParams({ ...(mode && { mode }), ...(search && { query: search }) })}`,
      ),
  });
  return (
    <>
      <PageHeader
        title="گفتگوها"
        subtitle={
          query.data
            ? `${query.data.length.toLocaleString('fa-IR')} گفتگو`
            : 'تاریخچه تعامل مشتریان'
        }
      />
      <SearchForm
        initialValue={search}
        placeholder="جستجوی نام، نام کاربری یا متن پیام"
        onSearch={(value) => {
          if (value) params.set('query', value);
          else params.delete('query');
          setParams(params);
        }}
      />
      <Filters
        name="mode"
        value={mode}
        options={[
          ['', 'همه'],
          ['AI', 'هوشمند'],
          ['HUMAN', 'انسانی'],
        ]}
      />
      <QueryState pending={query.isPending} error={query.error}>
        <div className="list spaced">
          {query.data?.length ? (
            query.data.map((item) => (
              <Link className="list-card" to={`/conversations/${item.id}`} key={item.id}>
                <div className="list-main">
                  <strong>{item.customer.name}</strong>
                  <span dir="auto">{item.lastMessage?.text ?? 'بدون پیام متنی'}</span>
                </div>
                <div className="list-meta">
                  <Badge status={item.mode} />
                  <time>{formatDate(item.updatedAt, true)}</time>
                </div>
              </Link>
            ))
          ) : (
            <EmptyState
              icon="◌"
              title="گفتگویی ثبت نشده است"
              description="پس از دریافت پیام مشتری، گفتگوها در این بخش نمایش داده می‌شوند."
            />
          )}
        </div>
      </QueryState>
    </>
  );
}

export function ConversationDetailPage() {
  const { id = '' } = useParams();
  const { businessPath } = useSession();
  const query = useQuery({
    queryKey: ['conversation', businessPath(''), id],
    queryFn: () =>
      request<ConversationDetail>(businessPath(`/conversations/${encodeURIComponent(id)}`)),
  });
  const detail = query.data;
  return (
    <QueryState pending={query.isPending} error={query.error}>
      {detail && (
        <>
          <PageHeader title="جزئیات گفتگو" subtitle="پیام‌ها و بینش‌های عملیاتی" />
          <section className="detail-hero">
            <Badge status={detail.mode} />
            <h2>{detail.customer.name}</h2>
            <p>
              {detail.customer.username ? `@${detail.customer.username}` : 'بدون نام کاربری عمومی'}
            </p>
          </section>
          <div className="split-grid">
            <MessageTimeline messages={detail.messages} />
            <aside className="grid">
              <Card title="اطلاعات گفتگو">
                <div className="key-values">
                  <KeyValue label="آخرین تغییر">{formatDate(detail.updatedAt)}</KeyValue>
                  <KeyValue label="پایان حالت انسانی">
                    {formatDate(detail.humanModeExpiresAt)}
                  </KeyValue>
                  <KeyValue label="شناسه تلگرام">
                    <bdi className="ltr">{detail.customer.telegramUserId}</bdi>
                  </KeyValue>
                </div>
              </Card>
              <Card title="بینش تصمیم‌های هوشمند">
                {detail.aiDecisions.length ? (
                  detail.aiDecisions.map((decision) => (
                    <details key={decision.id}>
                      <summary>
                        {decision.answerable ? 'پاسخ خودکار ارائه شد' : 'به پشتیبان ارجاع شد'} —{' '}
                        {formatDate(decision.createdAt)}
                      </summary>
                      <div className="key-values">
                        <KeyValue label="اطمینان">
                          {Math.round(decision.confidence * 100).toLocaleString('fa-IR')}٪
                        </KeyValue>
                        <KeyValue label="زمان پردازش">
                          {decision.latencyMs.toLocaleString('fa-IR')} میلی‌ثانیه
                        </KeyValue>
                        <KeyValue label="توضیح عملیاتی">
                          {decision.errorCode
                            ? 'پردازش به‌دلیل یک اختلال عملیاتی کامل نشد.'
                            : decision.answerable
                              ? 'پاسخ با تکیه بر دانش معتبر سامانه ارائه شد.'
                              : 'شواهد کافی برای ارائه پاسخ مطمئن وجود نداشت.'}
                        </KeyValue>
                      </div>
                    </details>
                  ))
                ) : (
                  <p className="muted">تصمیم هوشمندی برای نمایش ثبت نشده است.</p>
                )}
              </Card>
            </aside>
          </div>
        </>
      )}
    </QueryState>
  );
}
