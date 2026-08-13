import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { request, jsonBody } from '../../core/api';
import { faLabel, formatDate, outcomeLabels } from '../../core/format';
import type { HandoffDetail, HandoffSummary, Message } from '../../core/types';

interface ChatSummary extends Omit<HandoffSummary, 'expiresAt'> {
  updatedAt: string;
  expiresAt: string | null;
  lastMessage: Pick<Message, 'id' | 'text' | 'senderType' | 'sentAt'> | null;
}

interface AiBacklog {
  waitingConversations: number;
  oldestWaitingAt: string | null;
  nextAiActivationAt: string | null;
  aiAvailable: boolean;
  conversations: {
    conversationId: string;
    customer: { name: string; username: string | null };
    queuedMessageCount: number;
    waitingReason: string | null;
    oldestWaitingAt: string;
    mode: string;
    replyWindowOpen: boolean;
    replyWindowExpiresAt: string | null;
  }[];
}

export function AiBacklogPage() {
  const { businessPath, hasCapability } = useSession();
  const client = useQueryClient();
  const toast = useToast();
  const queryKey = ['ai-backlog', businessPath('')];
  const query = useQuery({
    queryKey,
    queryFn: () => request<AiBacklog>(businessPath('/ai-backlog')),
    refetchInterval: 15_000,
  });
  const action = useMutation({
    mutationFn: ({ conversationId, name }: { conversationId: string; name: string }) =>
      request(businessPath(`/ai-backlog/${encodeURIComponent(conversationId)}/${name}`), {
        method: 'POST',
      }),
    onSuccess: async () => {
      toast('درخواست ثبت شد.');
      await client.invalidateQueries({ queryKey });
    },
  });
  const canManage = hasCapability('settings:write');
  return (
    <>
      <PageHeader
        title="پیام‌های در انتظار پاسخ"
        subtitle={
          query.data
            ? `${query.data.waitingConversations.toLocaleString('fa-IR')} گفتگو`
            : 'صف پاسخ‌گویی هوشمند'
        }
      />
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <Card>
              <div className="key-values">
                <KeyValue label="قدیمی‌ترین انتظار">
                  {formatDate(query.data.oldestWaitingAt, true)}
                </KeyValue>
                <KeyValue label="فعال‌سازی بعدی">
                  {formatDate(query.data.nextAiActivationAt, true)}
                </KeyValue>
              </div>
              {canManage && !query.data.aiAvailable && (
                <div className="button-row">
                  <Link className="button" to="/settings">
                    فعال‌سازی پاسخ‌گویی هوشمند
                  </Link>
                </div>
              )}
            </Card>
            <div className="list spaced">
              {query.data.conversations.length ? (
                query.data.conversations.map((item) => (
                  <Card key={item.conversationId}>
                    <div className="list-main">
                      <strong>{item.customer.name}</strong>
                      <span>
                        {item.queuedMessageCount.toLocaleString('fa-IR')} پیام ·{' '}
                        {faLabel(item.waitingReason)}
                      </span>
                      <span>
                        حالت گفتگو: {faLabel(item.mode)} · پنجره تلگرام:{' '}
                        {item.replyWindowOpen ? 'باز' : 'بسته'}
                      </span>
                      <time>{formatDate(item.oldestWaitingAt, true)}</time>
                    </div>
                    <div className="button-row">
                      <Link className="button" to={`/conversations/${item.conversationId}`}>
                        مشاهده گفتگو
                      </Link>
                      {canManage && (
                        <Button
                          onClick={() =>
                            action.mutate({ conversationId: item.conversationId, name: 'handoff' })
                          }
                        >
                          ارجاع به پشتیبان
                        </Button>
                      )}
                      {canManage && (
                        <Button
                          variant="danger"
                          onClick={() =>
                            action.mutate({ conversationId: item.conversationId, name: 'cancel' })
                          }
                        >
                          لغو پاسخ خودکار
                        </Button>
                      )}
                      {canManage && query.data.aiAvailable && (
                        <Button
                          variant="primary"
                          onClick={() =>
                            action.mutate({
                              conversationId: item.conversationId,
                              name: 'process-now',
                            })
                          }
                        >
                          پردازش اکنون
                        </Button>
                      )}
                    </div>
                  </Card>
                ))
              ) : (
                <EmptyState
                  title="پیامی در انتظار نیست"
                  description="صف پاسخ‌گویی هوشمند خالی است."
                />
              )}
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}
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
  const newestFirst = [...messages].sort(
    (left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime(),
  );
  return (
    <div className="timeline">
      {newestFirst.map((message) => (
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
      request<ChatSummary[]>(
        `${businessPath('/handoffs')}?${new URLSearchParams({ ...(status && { status }), ...(search && { query: search }) })}`,
      ),
  });
  return (
    <>
      <PageHeader
        title="گفتگوها"
        subtitle={
          query.data
            ? `${query.data.length.toLocaleString('fa-IR')} مورد`
            : 'همه گفتگوها و وضعیت رسیدگی'
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
                  <span dir="auto">{item.lastMessage?.text ?? 'بدون پیام متنی'}</span>
                  {item.status !== 'NONE' && <small>{faLabel(item.reasonCode)}</small>}
                </div>
                <div className="list-meta">
                  <Badge status={item.status === 'NONE' ? item.mode : item.status} />
                  <time>{formatDate(item.updatedAt, true)}</time>
                </div>
              </Link>
            ))
          ) : (
            <EmptyState title="گفتگویی یافت نشد" description="گفتگویی با این وضعیت وجود ندارد." />
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
          <PageHeader title="جزئیات گفتگو" subtitle="پیام‌ها، وضعیت و اقدامات پشتیبانی" />
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
              <Card title="وضعیت گفتگو">
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
