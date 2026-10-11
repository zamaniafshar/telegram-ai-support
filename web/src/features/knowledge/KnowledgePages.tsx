import { useCallback, useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { request, jsonBody } from '../../core/api';
import { formatDate } from '../../core/format';
import { useTelegramMainButton, telegram } from '../../core/telegram';
import type { ExactAnswerItem, KnowledgeDraft, KnowledgeItem } from '../../core/types';
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
  exactAnswers?: ExactAnswerItem[];
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
  const [params, setParams] = useSearchParams();
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'KNOWLEDGE' | 'EXACT'>('ALL');
  const search = params.get('query') ?? '';
  const query = useQuery({
    queryKey: ['knowledge', businessPath(''), search],
    queryFn: () =>
      request<KnowledgeList>(
        `${businessPath('/knowledge')}${search ? `?query=${encodeURIComponent(search)}` : ''}`,
      ),
  });
  const result = query.data;
  const publishedList = result?.published ?? [];
  const draftsList = result?.drafts ?? [];
  const exactList = result?.exactAnswers ?? [];
  const totalCount = publishedList.length + draftsList.length + exactList.length;

  const showRAG = typeFilter === 'ALL' || typeFilter === 'KNOWLEDGE';
  const showExact = typeFilter === 'ALL' || typeFilter === 'EXACT';

  const handleCreateNew = () => {
    const typeParam = typeFilter === 'EXACT' ? '?type=exact' : '';
    void navigate(`/knowledge/new${typeParam}`);
  };

  return (
    <>
      <PageHeader
        title="مدیریت دانش و پاسخ‌ها"
        subtitle={
          result
            ? `${publishedList.length.toLocaleString('fa-IR')} منتشرشده RAG، ${draftsList.length.toLocaleString('fa-IR')} پیش‌نویس، ${exactList.length.toLocaleString('fa-IR')} پاسخ کپی‌پیست FAQ`
            : 'محتوای مورد استفاده برای پاسخ‌گویی هوشمند'
        }
        actions={
          <Button variant="primary" onClick={handleCreateNew}>
            تعریف محتوای جدید
          </Button>
        }
      />
      <SearchForm
        initialValue={search}
        placeholder="جستجو در عنوان، سوالات یا متن پاسخ‌ها"
        onSearch={(value) => {
          if (value) params.set('query', value);
          else params.delete('query');
          setParams(params);
        }}
      />
      <div className="filter-tabs" role="tablist">
        <button
          type="button"
          className={`filter-tab ${typeFilter === 'ALL' ? 'active' : ''}`}
          onClick={() => setTypeFilter('ALL')}
        >
          همه ({totalCount.toLocaleString('fa-IR')})
        </button>
        <button
          type="button"
          className={`filter-tab ${typeFilter === 'KNOWLEDGE' ? 'active' : ''}`}
          onClick={() => setTypeFilter('KNOWLEDGE')}
        >
          پایگاه دانش RAG ({(publishedList.length + draftsList.length).toLocaleString('fa-IR')})
        </button>
        <button
          type="button"
          className={`filter-tab ${typeFilter === 'EXACT' ? 'active' : ''}`}
          onClick={() => setTypeFilter('EXACT')}
        >
          پاسخ‌های کپی‌پیست FAQ ({exactList.length.toLocaleString('fa-IR')})
        </button>
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="list">
          {totalCount > 0 ? (
            <>
              {showRAG &&
                draftsList.map((draft) => (
                  <Link className="list-card" to={`/knowledge/drafts/${draft.id}`} key={draft.id}>
                    <div className="list-main">
                      <strong>{draft.title || 'پیش‌نویس بدون عنوان'}</strong>
                      <span>برای تکمیل و انتشار باز کنید</span>
                    </div>
                    <div className="list-meta">
                      <Badge status="DRAFT">پیش‌نویس RAG</Badge>
                      <time>{formatDate(draft.updatedAt, true)}</time>
                    </div>
                  </Link>
                ))}
              {showRAG &&
                publishedList.map((item) => (
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
                      <Badge status="KNOWLEDGE">دانش RAG</Badge>
                      <Badge status={item.indexingStatus} />
                      <time>{formatDate(item.updatedAt, true)}</time>
                    </div>
                  </Link>
                ))}
              {showExact &&
                exactList.map((exact) => (
                  <Link
                    className="list-card"
                    to={`/knowledge/exact-answers/${exact.id}`}
                    key={exact.id}
                  >
                    <div className="list-main">
                      <strong>{exact.name}</strong>
                      <span>
                        {exact.questions.length > 0
                          ? `${exact.questions.length.toLocaleString('fa-IR')} سوال: ${exact.questions
                              .map((q) => q.questionText)
                              .slice(0, 2)
                              .join(' | ')}`
                          : exact.content}
                      </span>
                    </div>
                    <div className="list-meta">
                      <Badge status="EXACT_ANSWER">پاسخ مستقیم FAQ</Badge>
                      <Badge status={exact.isActive ? 'READY' : 'FAILED'}>
                        {exact.isActive ? 'فعال' : 'غیرفعال'}
                      </Badge>
                      <time>{formatDate(exact.updatedAt, true)}</time>
                    </div>
                  </Link>
                ))}
            </>
          ) : (
            <EmptyState
              icon="▤"
              title="هنوز محتوایی ثبت نشده است"
              description="نخستین محتوا را ایجاد کنید. می‌توانید بین پایگاه دانش RAG یا پاسخ کپی‌پیست FAQ انتخاب کنید."
              action={
                <Button variant="primary" onClick={handleCreateNew}>
                  تعریف محتوای جدید
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
  const [searchParams] = useSearchParams();
  const { businessPath } = useSession();
  const navigate = useNavigate();
  const toast = useToast();

  const isNew = !id || id === 'new';
  const initialType = searchParams.get('type') === 'exact' ? 'EXACT_ANSWER' : 'KNOWLEDGE';
  const [contentType, setContentType] = useState<'KNOWLEDGE' | 'EXACT_ANSWER'>(initialType);
  const [draft, setDraft] = useState<KnowledgeDraft | null>(null);
  const [preview, setPreview] = useState<PreviewChunk[]>([]);
  const descriptionTextarea = useRef<HTMLTextAreaElement | null>(null);

  // Exact Answer fields state
  const [exactTitle, setExactTitle] = useState('');
  const [exactQuestions, setExactQuestions] = useState('');
  const [exactContent, setExactContent] = useState('');
  const [exactActive, setExactActive] = useState(true);

  const query = useQuery({
    queryKey: ['knowledge-draft', businessPath(''), id],
    queryFn: () =>
      request<KnowledgeDraft>(businessPath(`/knowledge/drafts/${encodeURIComponent(id)}`)),
    enabled: !isNew,
  });

  const activeDraft = draft ?? query.data ?? null;

  const form = useForm<DraftForm>({
    resolver: zodResolver(draftSchema),
    defaultValues: { title: '', description: '' },
  });

  useEffect(() => {
    if (query.data) {
      setDraft(query.data);
      form.reset({ title: query.data.title, description: query.data.description });
      setExactTitle((prev) => prev || query.data.title);
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
      const fields = values ?? form.getValues();
      let currentDraft = activeDraft;
      let targetId = id;

      if (isNew || !targetId || targetId === 'new') {
        const created = await request<KnowledgeDraft>(businessPath('/knowledge/drafts'), {
          method: 'POST',
          body: jsonBody({}),
        });
        currentDraft = created;
        targetId = created.id;
      }

      const updated = await request<KnowledgeDraft>(
        businessPath(`/knowledge/drafts/${encodeURIComponent(targetId)}`),
        {
          method: 'PATCH',
          body: jsonBody({
            revision: currentDraft?.revision ?? 1,
            title: fields.title,
            description: fields.description,
          }),
        },
      );
      setDraft(updated);
      form.reset(fields);
      if (isNew) {
        await navigate(`/knowledge/drafts/${updated.id}`, { replace: true });
      }
      return updated;
    },
    [activeDraft, businessPath, form, id, isNew, navigate],
  );

  const saveMutation = useMutation({
    mutationFn: (values: DraftForm) => save(values),
    onSuccess: () => toast('پیش‌نویس ذخیره شد.'),
    onError: (error) => toast(error.message, 'error'),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const valid = await form.trigger();
      if (!valid) throw new Error('لطفاً عنوان و توضیحات را برای پیش‌نمایش وارد کنید.');
      const saved = await save();
      return request<PreviewChunk[]>(
        businessPath(`/knowledge/drafts/${encodeURIComponent(saved.id)}/preview`),
        { method: 'POST' },
      );
    },
    onSuccess: setPreview,
    onError: (error) => toast(error.message, 'error'),
  });

  const publish = useCallback(async () => {
    try {
      const valid = await form.trigger();
      if (!valid) return;
      const saved = await save();
      const confirmed = await confirm({
        title: 'انتشار دانش',
        message: 'این دانش منتشر و برای پردازش در صف قرار گیرد؟',
        confirmLabel: 'انتشار',
      });
      if (!confirmed) return;
      const item = await request<KnowledgeItem>(
        businessPath(`/knowledge/drafts/${encodeURIComponent(saved.id)}/publish`),
        { method: 'POST', body: jsonBody({ revision: saved.revision }) },
      );
      toast('دانش منتشر و برای پردازش در صف قرار گرفت.');
      await navigate(`/knowledge/${item.id}`, { replace: true });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'انتشار انجام نشد.', 'error');
    }
  }, [businessPath, confirm, form, navigate, save, toast]);

  const createExactMutation = useMutation({
    mutationFn: (body: { name: string; content: string; questions: string[]; isActive: boolean }) =>
      request<ExactAnswerItem>(businessPath('/exact-answers'), {
        method: 'POST',
        body: jsonBody(body),
      }),
    onSuccess: async (created) => {
      toast('پاسخ کپی‌پیست FAQ با موفقیت ثبت شد.');
      await navigate(`/knowledge/exact-answers/${created.id}`, { replace: true });
    },
    onError: (error) => toast(error.message, 'error'),
  });

  const handleSaveExact = () => {
    const name = exactTitle.trim();
    const content = exactContent.trim();
    const questions = exactQuestions
      .split('\n')
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    if (!name) {
      toast('عنوان پاسخ الزامی است.', 'error');
      return;
    }
    if (questions.length === 0) {
      toast('حداقل یک نمونه سوال الزامی است.', 'error');
      return;
    }
    if (!content) {
      toast('متن دقیق پاسخ الزامی است.', 'error');
      return;
    }

    createExactMutation.mutate({
      name,
      content,
      questions,
      isActive: exactActive,
    });
  };

  const isReady = isNew || Boolean(activeDraft);

  useTelegramMainButton(
    contentType === 'KNOWLEDGE' ? 'انتشار دانش' : 'ذخیره پاسخ کپی‌پیست',
    () => {
      if (contentType === 'KNOWLEDGE') {
        void publish();
      } else {
        handleSaveExact();
      }
    },
    isReady,
  );

  const descriptionField = form.register('description');
  return (
    <QueryState pending={!isNew && query.isPending} error={!isNew ? query.error : null}>
      {isReady && (
        <>
          <PageHeader
            title={isNew ? 'تعریف محتوای جدید' : 'تعریف و ویرایش محتوا'}
            subtitle={
              contentType === 'KNOWLEDGE'
                ? ((activeDraft?.title.trim() ? activeDraft.title : undefined) ??
                  (form.watch('title').trim() ? form.watch('title') : undefined) ??
                  'پیش‌نویس پایگاه دانش RAG')
                : exactTitle.trim()
                  ? exactTitle
                  : 'پاسخ مستقیم و کپی‌پیست FAQ'
            }
            actions={
              <Badge status={contentType === 'KNOWLEDGE' ? 'DRAFT' : 'EXACT_ANSWER'}>
                {contentType === 'KNOWLEDGE' ? 'پیش‌نویس RAG' : 'پاسخ کپی‌پیست'}
              </Badge>
            }
          />
          <div className="split-grid">
            <div className="form-card">
              <label className="field">
                نوع محتوا
                <div className="type-selector-grid" style={{ marginTop: '8px' }}>
                  <button
                    type="button"
                    className={`type-option-card ${contentType === 'KNOWLEDGE' ? 'selected' : ''}`}
                    onClick={() => {
                      setContentType('KNOWLEDGE');
                      if (!form.getValues('title') && exactTitle) {
                        form.setValue('title', exactTitle);
                      }
                    }}
                  >
                    <strong>📘 پایگاه دانش (RAG)</strong>
                    <span>استناد و تولید پاسخ هوشمند توسط هوش مصنوعی بر مبنای متن</span>
                  </button>
                  <button
                    type="button"
                    className={`type-option-card ${contentType === 'EXACT_ANSWER' ? 'selected' : ''}`}
                    onClick={() => {
                      setContentType('EXACT_ANSWER');
                      if (!exactTitle && form.getValues('title')) {
                        setExactTitle(form.getValues('title'));
                      }
                    }}
                  >
                    <strong>⚡ پاسخ مستقیم و کپی‌پیست (FAQ)</strong>
                    <span>پاسخ قطعی و بدون تغییر در صورت تطابق با سوالات کاربر</span>
                  </button>
                </div>
                <select
                  value={contentType}
                  onChange={(e) => {
                    const next = e.target.value as 'KNOWLEDGE' | 'EXACT_ANSWER';
                    setContentType(next);
                    if (next === 'EXACT_ANSWER' && !exactTitle) {
                      setExactTitle(form.getValues('title'));
                    } else if (next === 'KNOWLEDGE' && !form.getValues('title')) {
                      form.setValue('title', exactTitle);
                    }
                  }}
                  style={{ display: 'none' }}
                >
                  <option value="KNOWLEDGE">پایگاه دانش (RAG) — استناد و تولید پاسخ هوشمند</option>
                  <option value="EXACT_ANSWER">
                    پاسخ مستقیم و کپی‌پیست (FAQ) — بدون تغییر و بدون هزینه LLM
                  </option>
                </select>
                <small>
                  {contentType === 'KNOWLEDGE'
                    ? 'پایگاه دانش برای متن‌های مفصل است که مدل هوش مصنوعی با استناد به آن‌ها پاسخ تولید می‌کند.'
                    : 'پاسخ کپی‌پیست در صورت تطابق با سوالات کاربر، عیناً و مستقیم بدون دخالت هوش مصنوعی ارسال می‌شود.'}
                </small>
              </label>

              {contentType === 'KNOWLEDGE' ? (
                <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}>
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
                      <small className="field-error">
                        {form.formState.errors.description.message}
                      </small>
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
              ) : (
                <div>
                  <label className="field">
                    عنوان پاسخ
                    <input
                      value={exactTitle}
                      onChange={(e) => setExactTitle(e.target.value)}
                      maxLength={200}
                      placeholder="برای نمونه: شماره شبا و کارت فروشگاه"
                    />
                    <small>این نام برای دسته‌بندی و شناسایی در پنل مدیریت است.</small>
                  </label>
                  <label className="field">
                    نمونه سوالات مرتبط (هر خط یک سوال)
                    <textarea
                      value={exactQuestions}
                      onChange={(e) => setExactQuestions(e.target.value)}
                      style={{ minHeight: '140px' }}
                      placeholder={`شماره حساب برای واریز چیه؟\nشماره کارت بدید\nبه چه حسابی واریز کنم؟`}
                    />
                    <small>
                      هر خط یک نمونه سوال است که هوش مصنوعی در صورت تشابه، پاسخ زیر را دقیقاً ارسال
                      خواهد کرد.
                    </small>
                  </label>
                  <label className="field">
                    متن دقیق پاسخ (کپی‌پیست)
                    <textarea
                      value={exactContent}
                      onChange={(e) => setExactContent(e.target.value)}
                      style={{ minHeight: '180px' }}
                      placeholder={`متن پیام اول...\n***\nمتن پیام دوم (ارسال به عنوان پیام مجزا در تلگرام)...`}
                    />
                    <small>
                      این متن عیناً برای مشتری ارسال می‌شود. برای تقسیم پاسخ به چند پیام مجزا در
                      تلگرام، بین پیام‌ها از جداکننده <strong>***</strong> استفاده کنید.
                    </small>
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '18px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={exactActive}
                      onChange={(e) => setExactActive(e.target.checked)}
                    />
                    <span>فعال در پاسخ‌گویی خودکار</span>
                  </label>
                  <div className="button-row">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={createExactMutation.isPending}
                      onClick={handleSaveExact}
                    >
                      {createExactMutation.isPending && (
                        <span className="button-spinner" aria-hidden="true" />
                      )}
                      ذخیره پاسخ کپی‌پیست
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <aside>
              {contentType === 'KNOWLEDGE' ? (
                <Card title="پیش‌نمایش بخش‌های RAG">
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
              ) : (
                <Card title="پیش‌نمایش پاسخ کپی‌پیست">
                  <div style={{ display: 'grid', gap: '14px' }}>
                    <div>
                      <strong style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                        سوالات تفکیک‌شده (
                        {
                          exactQuestions
                            .split('\n')
                            .map((q) => q.trim())
                            .filter(Boolean).length
                        }
                        ):
                      </strong>
                      {exactQuestions
                        .split('\n')
                        .map((q) => q.trim())
                        .filter(Boolean).length > 0 ? (
                        <ul
                          style={{
                            margin: '6px 0 0',
                            paddingInlineStart: '18px',
                            fontSize: '0.88rem',
                          }}
                        >
                          {exactQuestions
                            .split('\n')
                            .map((q) => q.trim())
                            .filter(Boolean)
                            .map((q, i) => (
                              <li key={i}>{q}</li>
                            ))}
                        </ul>
                      ) : (
                        <p className="muted" style={{ margin: '4px 0 0' }}>
                          هنوز نمونه سوالی وارد نشده است.
                        </p>
                      )}
                    </div>
                    <div>
                      <strong style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                        متن خروجی Verbatim:
                      </strong>
                      {exactContent.trim() ? (
                        <div className="chunk pre-wrap" dir="auto" style={{ marginTop: '6px' }}>
                          {exactContent}
                        </div>
                      ) : (
                        <p className="muted" style={{ margin: '4px 0 0' }}>
                          متن پاسخ خالی است.
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              )}
            </aside>
          </div>
        </>
      )}
    </QueryState>
  );
}

export function ExactAnswerDetailPage() {
  const { id = '' } = useParams();
  const { businessPath } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const [editName, setEditName] = useState('');
  const [editQuestions, setEditQuestions] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editActive, setEditActive] = useState(true);

  const queryKey = ['exact-answer-detail', businessPath(''), id];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      request<ExactAnswerItem>(businessPath(`/exact-answers/${encodeURIComponent(id)}`)),
  });

  const item = query.data;

  useEffect(() => {
    if (item) {
      setEditName(item.name);
      setEditQuestions(item.questions.map((q) => q.questionText).join('\n'));
      setEditContent(item.content);
      setEditActive(item.isActive);
    }
  }, [item]);

  const toggleActiveMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      request<ExactAnswerItem>(businessPath(`/exact-answers/${encodeURIComponent(id)}/active`), {
        method: 'PATCH',
        body: jsonBody({ isActive }),
      }),
    onSuccess: async (updated) => {
      await client.invalidateQueries({ queryKey });
      await client.invalidateQueries({ queryKey: ['knowledge'] });
      toast(updated.isActive ? 'پاسخ فعال شد.' : 'پاسخ غیرفعال شد.');
    },
    onError: (error) => toast(error.message, 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: (body: { name: string; content: string; questions: string[]; isActive: boolean }) =>
      request<ExactAnswerItem>(businessPath(`/exact-answers/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        body: jsonBody(body),
      }),
    onSuccess: async () => {
      setEditing(false);
      await client.invalidateQueries({ queryKey });
      await client.invalidateQueries({ queryKey: ['knowledge'] });
      toast('تغییرات پاسخ با موفقیت ذخیره شد.');
    },
    onError: (error) => toast(error.message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      request<{ ok: boolean }>(businessPath(`/exact-answers/${encodeURIComponent(id)}`), {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      setDeleteOpen(false);
      await client.invalidateQueries({ queryKey: ['knowledge'] });
      toast('پاسخ کپی‌پیست و بردارهای آن با موفقیت حذف شدند.');
      await navigate('/knowledge', { replace: true });
    },
    onError: (error) => toast(error.message, 'error'),
  });

  const handleSaveUpdate = () => {
    const name = editName.trim();
    const content = editContent.trim();
    const questions = editQuestions
      .split('\n')
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    if (!name) {
      toast('عنوان پاسخ الزامی است.', 'error');
      return;
    }
    if (questions.length === 0) {
      toast('حداقل یک نمونه سوال الزامی است.', 'error');
      return;
    }
    if (!content) {
      toast('متن دقیق پاسخ الزامی است.', 'error');
      return;
    }

    updateMutation.mutate({
      name,
      content,
      questions,
      isActive: editActive,
    });
  };

  return (
    <QueryState pending={query.isPending} error={query.error}>
      {item && (
        <>
          <PageHeader
            title="جزئیات پاسخ مستقیم FAQ"
            subtitle={item.name}
            actions={
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Badge status="EXACT_ANSWER">پاسخ مستقیم FAQ</Badge>
                <Badge status={item.isActive ? 'READY' : 'FAILED'}>
                  {item.isActive ? 'فعال' : 'غیرفعال'}
                </Badge>
              </div>
            }
          />

          {editing ? (
            <div className="split-grid">
              <div className="form-card">
                <h3>ویرایش پاسخ کپی‌پیست</h3>
                <label className="field">
                  عنوان پاسخ
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={200}
                  />
                  <small>این نام برای دسته‌بندی و شناسایی در پنل مدیریت است.</small>
                </label>
                <label className="field">
                  نمونه سوالات مرتبط (هر خط یک سوال)
                  <textarea
                    value={editQuestions}
                    onChange={(e) => setEditQuestions(e.target.value)}
                    style={{ minHeight: '140px' }}
                  />
                  <small>هر خط یک سوال است که در Qdrant بردارسازی خواهد شد.</small>
                </label>
                <label className="field">
                  متن دقیق پاسخ (کپی‌پیست)
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    style={{ minHeight: '180px' }}
                    placeholder={`متن پیام اول...\n***\nمتن پیام دوم (ارسال به عنوان پیام مجزا در تلگرام)...`}
                  />
                  <small>
                    این متن عیناً برای مشتری ارسال می‌شود. برای تفکیک پیام‌ها در تلگرام از جداکننده{' '}
                    <strong>***</strong> استفاده کنید.
                  </small>
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '18px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                  />
                  <span>فعال در پاسخ‌گویی خودکار</span>
                </label>
                <div className="button-row">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={updateMutation.isPending}
                    onClick={handleSaveUpdate}
                  >
                    {updateMutation.isPending && (
                      <span className="button-spinner" aria-hidden="true" />
                    )}
                    ذخیره تغییرات
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setEditName(item.name);
                      setEditQuestions(item.questions.map((q) => q.questionText).join('\n'));
                      setEditContent(item.content);
                      setEditActive(item.isActive);
                    }}
                  >
                    انصراف
                  </Button>
                </div>
              </div>
              <aside>
                <Card title="راهنما">
                  <p className="muted" style={{ lineHeight: 1.8 }}>
                    پس از ذخیره تغییرات، سوالات جدید به صورت خودکار در دیتابیس برداری Qdrant
                    بروزرسانی خواهند شد. در صورتی که مشتری سوالی مشابه بپرسد، متن دقیق این پاسخ بدون
                    استفاده از توکن‌های مدل زبانی ارسال می‌شود.
                  </p>
                </Card>
              </aside>
            </div>
          ) : (
            <div className="split-grid">
              <section className="grid" style={{ display: 'grid', gap: '16px' }}>
                <Card
                  title={`متن دقیق پاسخ (کپی‌پیست)${
                    item.content.includes('***')
                      ? ` (${item.content
                          .split(/(?:\r?\n)*\s*\*{3,}\s*(?:\r?\n)*/)
                          .map((p) => p.trim())
                          .filter(Boolean)
                          .length.toLocaleString('fa-IR')} پیام مجزا)`
                      : ''
                  }`}
                >
                  {item.content.includes('***') ? (
                    <div style={{ display: 'grid', gap: '10px' }}>
                      {item.content
                        .split(/(?:\r?\n)*\s*\*{3,}\s*(?:\r?\n)*/)
                        .map((p) => p.trim())
                        .filter(Boolean)
                        .map((part, pIdx) => (
                          <div
                            key={pIdx}
                            className="chunk"
                            dir="auto"
                            style={{
                              borderRight: '3px solid var(--primary, #0ea5e9)',
                              background: 'var(--surface-sunken, #0f172a)',
                              padding: '10px 14px',
                              borderRadius: '8px',
                            }}
                          >
                            <span
                              className="muted"
                              style={{
                                fontSize: '0.8rem',
                                display: 'block',
                                marginBottom: '4px',
                                fontWeight: 600,
                              }}
                            >
                              پیام {(pIdx + 1).toLocaleString('fa-IR')}
                            </span>
                            <p className="pre-wrap" style={{ margin: 0 }}>
                              {part}
                            </p>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="pre-wrap" dir="auto">
                      {item.content}
                    </p>
                  )}
                </Card>
                <Card
                  title={`نمونه سوالات مرتبط (${item.questions.length.toLocaleString('fa-IR')} سوال)`}
                >
                  {item.questions.length ? (
                    item.questions.map((q, idx) => (
                      <div className="chunk" dir="auto" key={q.id}>
                        <strong>سوال {(idx + 1).toLocaleString('fa-IR')}</strong>
                        <br />
                        {q.questionText}
                      </div>
                    ))
                  ) : (
                    <p className="muted">سوالی ثبت نشده است.</p>
                  )}
                </Card>
                <div className="button-row">
                  <Button
                    onClick={() => toggleActiveMutation.mutate(!item.isActive)}
                    disabled={toggleActiveMutation.isPending}
                  >
                    {item.isActive ? 'غیرفعال‌سازی در پاسخ‌گویی' : 'فعال‌سازی در پاسخ‌گویی'}
                  </Button>
                  <Button onClick={() => setEditing(true)}>ویرایش پاسخ</Button>
                  <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                    حذف پاسخ
                  </Button>
                </div>
              </section>
              <aside>
                <Card title="اطلاعات">
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <KeyValue label="وضعیت">{item.isActive ? 'فعال' : 'غیرفعال'}</KeyValue>
                    <KeyValue label="تعداد سوالات بردارشده">
                      {item.questions.length.toLocaleString('fa-IR')}
                    </KeyValue>
                    <KeyValue label="تاریخ ثبت">{formatDate(item.createdAt)}</KeyValue>
                    <KeyValue label="آخرین بروزرسانی">{formatDate(item.updatedAt, true)}</KeyValue>
                  </div>
                </Card>
              </aside>
            </div>
          )}

          {deleteOpen && (
            <Dialog
              title="حذف پاسخ مستقیم FAQ"
              description="آیا از حذف این پاسخ و کلیه سوالات و بردارهای مربوط به آن اطمینان دارید؟"
              onClose={() => setDeleteOpen(false)}
            >
              <div className="button-row" style={{ marginTop: '16px' }}>
                <Button onClick={() => setDeleteOpen(false)}>انصراف</Button>
                <Button
                  variant="danger"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending && (
                    <span className="button-spinner" aria-hidden="true" />
                  )}
                  {deleteMutation.isPending ? 'در حال حذف…' : 'تأیید حذف'}
                </Button>
              </div>
            </Dialog>
          )}
        </>
      )}
    </QueryState>
  );
}
