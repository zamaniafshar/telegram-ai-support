import { useCallback, useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { request, jsonBody } from '../../core/api';
import { formatDate } from '../../core/format';
import { useTelegramMainButton, telegram } from '../../core/telegram';
import type { KnowledgeDraft, KnowledgeItem } from '../../core/types';
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
import { useConfirmation } from '../../app/ConfirmationProvider';

interface KnowledgeList {
  published: KnowledgeItem[];
  drafts: KnowledgeDraft[];
}
interface KnowledgeDetail {
  item: KnowledgeItem;
  chunks: { id: string; chunkIndex: number; content: string }[];
  jobs: unknown[];
  draft: KnowledgeDraft | null;
}
interface PreviewChunk {
  index: number;
  content: string;
}

interface KnowledgeDeletion {
  ok: boolean;
  cleanupStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'RETRY';
  cleanupJobId: string;
}

function resizeDescriptionTextarea(element: HTMLTextAreaElement): void {
  element.style.height = 'auto';
  const configuredMaxHeight = Number.parseFloat(getComputedStyle(element).maxHeight);
  const contentHeight = element.scrollHeight;
  const height = Number.isFinite(configuredMaxHeight)
    ? Math.min(contentHeight, configuredMaxHeight)
    : contentHeight;
  element.style.height = `${height}px`;
  element.style.overflowY = contentHeight > height ? 'auto' : 'hidden';
}

export function KnowledgePage() {
  const { businessPath } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const search = params.get('query') ?? '';
  const query = useQuery({
    queryKey: ['knowledge', businessPath(''), search],
    queryFn: () =>
      request<KnowledgeList>(
        `${businessPath('/knowledge')}${search ? `?query=${encodeURIComponent(search)}` : ''}`,
      ),
  });
  const create = useMutation({
    mutationFn: () =>
      request<KnowledgeDraft>(businessPath('/knowledge/drafts'), {
        method: 'POST',
        body: jsonBody({}),
      }),
    onSuccess: (draft) => navigate(`/knowledge/drafts/${draft.id}`),
    onError: (error) => toast(error.message, 'error'),
  });
  const result = query.data;
  return (
    <>
      <PageHeader
        title="مدیریت دانش"
        subtitle={
          result
            ? `${result.published.length.toLocaleString('fa-IR')} منتشرشده، ${result.drafts.length.toLocaleString('fa-IR')} پیش‌نویس`
            : 'محتوای مورد استفاده برای پاسخ‌گویی'
        }
        actions={
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
            ایجاد پیش‌نویس
          </Button>
        }
      />
      <SearchForm
        initialValue={search}
        placeholder="جستجو در عنوان یا محتوا"
        onSearch={(value) => {
          if (value) params.set('query', value);
          else params.delete('query');
          setParams(params);
        }}
      />
      <QueryState pending={query.isPending} error={query.error}>
        <div className="list">
          {result && (result.drafts.length || result.published.length) ? (
            <>
              {result.drafts.map((draft) => (
                <Link className="list-card" to={`/knowledge/drafts/${draft.id}`} key={draft.id}>
                  <div className="list-main">
                    <strong>{draft.title || 'پیش‌نویس بدون عنوان'}</strong>
                    <span>برای تکمیل و انتشار باز کنید</span>
                  </div>
                  <div className="list-meta">
                    <Badge status="DRAFT">پیش‌نویس</Badge>
                    <time>{formatDate(draft.updatedAt, true)}</time>
                  </div>
                </Link>
              ))}
              {result.published.map((item) => (
                <Link className="list-card" to={`/knowledge/${item.id}`} key={item.id}>
                  <div className="list-main">
                    <strong>{item.title}</strong>
                    <span>
                      {item.isActive
                        ? 'در پاسخ‌گویی قابل استفاده است'
                        : 'از پاسخ‌گویی خارج شده است'}
                    </span>
                  </div>
                  <div className="list-meta">
                    <Badge status={item.indexingStatus} />
                    <time>{formatDate(item.updatedAt, true)}</time>
                  </div>
                </Link>
              ))}
            </>
          ) : (
            <EmptyState
              icon="▤"
              title="هنوز دانشی ثبت نشده است"
              description="نخستین پیش‌نویس را ایجاد و پس از بازبینی منتشر کنید."
              action={
                <Button variant="primary" onClick={() => create.mutate()}>
                  ایجاد پیش‌نویس
                </Button>
              }
            />
          )}
        </div>
      </QueryState>
    </>
  );
}

export function KnowledgeDetailPage() {
  const { id = '' } = useParams();
  const { businessPath } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const queryKey = ['knowledge-detail', businessPath(''), id];
  const query = useQuery({
    queryKey,
    queryFn: () => request<KnowledgeDetail>(businessPath(`/knowledge/${encodeURIComponent(id)}`)),
  });
  const mutate = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) =>
      request<KnowledgeItem | { ok: boolean }>(businessPath(path), {
        method,
        ...(body === undefined ? {} : { body: jsonBody(body) }),
      }),
    onError: (error) => toast(error.message, 'error'),
  });
  const deleteMutation = useMutation({
    mutationFn: () =>
      request<KnowledgeDeletion>(businessPath(`/knowledge/${encodeURIComponent(id)}`), {
        method: 'DELETE',
      }),
    onSuccess: async (deletion) => {
      setDeleteOpen(false);
      await client.invalidateQueries({ queryKey: ['knowledge'] });
      toast(
        deletion.cleanupStatus === 'COMPLETED'
          ? 'دانش و داده‌های Qdrant حذف شدند.'
          : 'دانش حذف شد؛ پاک‌سازی Qdrant در صف پردازش قرار گرفت.',
      );
      await navigate('/knowledge', { replace: true });
    },
    onError: (error) => toast(error.message, 'error'),
  });
  const refresh = async (message: string) => {
    toast(message);
    await client.invalidateQueries({ queryKey });
  };
  const item = query.data?.item;
  const edit = async () => {
    if (!item) return;
    const draft = await request<KnowledgeDraft>(businessPath('/knowledge/drafts'), {
      method: 'POST',
      body: jsonBody({ knowledgeItemId: item.id }),
    });
    await navigate(`/knowledge/drafts/${draft.id}`);
  };
  const remove = () => {
    if (!item || deleteMutation.isPending) return;
    setDeleteOpen(true);
  };
  return (
    <QueryState pending={query.isPending} error={query.error}>
      {item && query.data && (
        <>
          <PageHeader title="جزئیات دانش" subtitle={item.title} />
          <section className="detail-hero">
            <Badge status={item.indexingStatus} />
            <h2>{item.title}</h2>
            <p>نسخه {item.version.toLocaleString('fa-IR')}</p>
          </section>
          {item.indexingStatus === 'FAILED' && (
            <div className="notice error">
              <span>!</span>
              <div>
                <strong>پردازش دانش ناموفق بود</strong>
                <p>پس از بررسی اتصال سرویس، تلاش دوباره را اجرا کنید.</p>
              </div>
            </div>
          )}
          <div className="split-grid">
            <section className="grid">
              <Card title="محتوا">
                <p className="pre-wrap" dir="auto">
                  {item.description}
                </p>
              </Card>
              <Card title="پیش‌نمایش بخش‌ها">
                {query.data.chunks.length ? (
                  query.data.chunks.map((chunk) => (
                    <div className="chunk" dir="auto" key={chunk.id}>
                      <strong>بخش {(chunk.chunkIndex + 1).toLocaleString('fa-IR')}</strong>
                      <br />
                      {chunk.content}
                    </div>
                  ))
                ) : (
                  <p className="muted">هنوز بخش آماده‌ای ثبت نشده است.</p>
                )}
              </Card>
            </section>
            <aside className="grid">
              <Card title="اقدامات">
                <div className="button-row">
                  <Button variant="primary" onClick={() => void edit()}>
                    ویرایش در پیش‌نویس
                  </Button>
                  <Button
                    onClick={() =>
                      mutate.mutate(
                        {
                          path: `/knowledge/${id}/active`,
                          method: 'PATCH',
                          body: { isActive: !item.isActive },
                        },
                        { onSuccess: () => void refresh('وضعیت دانش تغییر کرد.') },
                      )
                    }
                  >
                    {item.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                  </Button>
                  {item.indexingStatus === 'FAILED' && (
                    <Button
                      onClick={() =>
                        mutate.mutate(
                          { path: `/knowledge/${id}/indexing/retry`, method: 'POST' },
                          { onSuccess: () => void refresh('پردازش دانش دوباره در صف قرار گرفت.') },
                        )
                      }
                    >
                      تلاش دوباره
                    </Button>
                  )}
                  <Button variant="danger" onClick={remove} disabled={deleteMutation.isPending}>
                    {deleteMutation.isPending ? 'در حال حذف…' : 'حذف دانش'}
                  </Button>
                </div>
              </Card>
              <Card title="وضعیت">
                <div className="key-values">
                  <KeyValue label="فعال">{item.isActive ? 'بله' : 'خیر'}</KeyValue>
                  <KeyValue label="آخرین تغییر">{formatDate(item.updatedAt)}</KeyValue>
                  <KeyValue label="تعداد بخش‌ها">
                    {query.data.chunks.length.toLocaleString('fa-IR')}
                  </KeyValue>
                </div>
              </Card>
            </aside>
          </div>
          {deleteOpen && (
            <Dialog
              title="حذف دانش"
              description={`دانش «${item.title}» حذف شود؟ پس از تأیید، فوراً از پاسخ‌گویی خارج و پاک‌سازی آن از Qdrant در صف قرار می‌گیرد.`}
              placement="top"
              onClose={() => {
                if (!deleteMutation.isPending) setDeleteOpen(false);
              }}
            >
              <div className="button-row" aria-busy={deleteMutation.isPending}>
                <Button
                  type="button"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleteMutation.isPending}
                >
                  لغو
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending && (
                    <span className="button-spinner" aria-hidden="true" />
                  )}
                  {deleteMutation.isPending ? 'در حال حذف و ثبت در صف…' : 'تأیید حذف'}
                </Button>
              </div>
            </Dialog>
          )}
        </>
      )}
    </QueryState>
  );
}

const draftSchema = z.object({
  title: z.string().trim().min(1, 'عنوان الزامی است').max(200),
  description: z.string().trim().min(1, 'توضیحات الزامی است').max(100_000),
});
type DraftForm = z.infer<typeof draftSchema>;

export function DraftEditorPage() {
  const confirm = useConfirmation();
  const { id = '' } = useParams();
  const { businessPath } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState<KnowledgeDraft | null>(null);
  const [preview, setPreview] = useState<PreviewChunk[]>([]);
  const descriptionTextarea = useRef<HTMLTextAreaElement | null>(null);
  const query = useQuery({
    queryKey: ['knowledge-draft', businessPath(''), id],
    queryFn: () =>
      request<KnowledgeDraft>(businessPath(`/knowledge/drafts/${encodeURIComponent(id)}`)),
  });
  const form = useForm<DraftForm>({
    resolver: zodResolver(draftSchema),
    defaultValues: { title: '', description: '' },
  });
  useEffect(() => {
    if (query.data) {
      setDraft(query.data);
      form.reset({ title: query.data.title, description: query.data.description });
    }
  }, [form, query.data]);
  useEffect(() => {
    const resize = () => {
      if (descriptionTextarea.current) resizeDescriptionTextarea(descriptionTextarea.current);
    };
    const animationFrame = requestAnimationFrame(resize);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [query.data?.description]);
  const dirty = form.formState.isDirty;
  useEffect(() => {
    if (dirty) telegram?.enableClosingConfirmation?.();
    else telegram?.disableClosingConfirmation?.();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      telegram?.disableClosingConfirmation?.();
    };
  }, [dirty]);
  const save = useCallback(
    async (values?: DraftForm) => {
      if (!draft) throw new Error('پیش‌نویس هنوز آماده نیست.');
      const fields = values ?? form.getValues();
      const updated = await request<KnowledgeDraft>(
        businessPath(`/knowledge/drafts/${encodeURIComponent(id)}`),
        { method: 'PATCH', body: jsonBody({ revision: draft.revision, ...fields }) },
      );
      setDraft(updated);
      form.reset(fields);
      return updated;
    },
    [businessPath, draft, form, id],
  );
  const saveMutation = useMutation({
    mutationFn: (values: DraftForm) => save(values),
    onSuccess: () => toast('پیش‌نویس ذخیره شد.'),
    onError: (error) => toast(error.message, 'error'),
  });
  const previewMutation = useMutation({
    mutationFn: async () => {
      if (dirty) await save();
      return request<PreviewChunk[]>(
        businessPath(`/knowledge/drafts/${encodeURIComponent(id)}/preview`),
        { method: 'POST' },
      );
    },
    onSuccess: setPreview,
    onError: (error) => toast(error.message, 'error'),
  });
  const publish = useCallback(async () => {
    try {
      const current = dirty ? await save() : draft;
      if (!current) return;
      const confirmed = await confirm({
        title: 'انتشار دانش',
        message: 'این دانش منتشر و برای پردازش در صف قرار گیرد؟',
        confirmLabel: 'انتشار',
      });
      if (!confirmed) return;
      const item = await request<KnowledgeItem>(
        businessPath(`/knowledge/drafts/${encodeURIComponent(id)}/publish`),
        { method: 'POST', body: jsonBody({ revision: current.revision }) },
      );
      toast('دانش منتشر و برای پردازش در صف قرار گرفت.');
      await navigate(`/knowledge/${item.id}`, { replace: true });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'انتشار انجام نشد.', 'error');
    }
  }, [businessPath, confirm, dirty, draft, id, navigate, save, toast]);
  useTelegramMainButton('انتشار دانش', () => void publish(), Boolean(draft));
  const descriptionField = form.register('description');
  return (
    <QueryState pending={query.isPending} error={query.error}>
      {draft && (
        <>
          <PageHeader
            title="ویرایش پیش‌نویس"
            subtitle={draft.title || 'بدون عنوان'}
            actions={<Badge status="DRAFT">پیش‌نویس</Badge>}
          />
          <div className="split-grid">
            <form
              className="form-card"
              onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            >
              <label className="field">
                عنوان
                <input
                  {...form.register('title')}
                  maxLength={200}
                  placeholder="برای نمونه: شرایط بازگشت وجه"
                />
                {form.formState.errors.title && (
                  <small className="field-error">{form.formState.errors.title.message}</small>
                )}
              </label>
              <label className="field">
                توضیحات کامل
                <textarea
                  {...descriptionField}
                  ref={(element) => {
                    descriptionField.ref(element);
                    descriptionTextarea.current = element;
                  }}
                  className="knowledge-description-textarea"
                  onInput={(event) => resizeDescriptionTextarea(event.currentTarget)}
                  maxLength={100000}
                  placeholder="اطلاعات دقیق و قابل استناد را بنویسید"
                />
                {form.formState.errors.description && (
                  <small className="field-error">{form.formState.errors.description.message}</small>
                )}
                <small>این متن منبع پاسخ‌گویی هوشمند خواهد بود.</small>
              </label>
              <div className="button-row">
                <Button type="submit" disabled={saveMutation.isPending}>
                  ذخیره پیش‌نویس
                </Button>
                <Button
                  type="button"
                  onClick={() => previewMutation.mutate()}
                  disabled={previewMutation.isPending}
                >
                  پیش‌نمایش بخش‌ها
                </Button>
                <Button type="button" variant="primary" onClick={() => void publish()}>
                  انتشار دانش
                </Button>
              </div>
            </form>
            <aside>
              <Card title="پیش‌نمایش">
                {preview.length ? (
                  preview.map((chunk) => (
                    <div className="chunk" dir="auto" key={chunk.index}>
                      <strong>بخش {(chunk.index + 1).toLocaleString('fa-IR')}</strong>
                      <br />
                      {chunk.content}
                    </div>
                  ))
                ) : (
                  <p className="muted">برای دیدن نحوه تقسیم محتوا، پیش‌نمایش را اجرا کنید.</p>
                )}
              </Card>
            </aside>
          </div>
        </>
      )}
    </QueryState>
  );
}
