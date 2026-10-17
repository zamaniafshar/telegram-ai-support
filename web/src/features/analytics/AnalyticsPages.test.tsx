// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../../core/api';
import { AnalyticsTracePage } from './AnalyticsPages';

vi.mock('../../core/api', () => ({ request: vi.fn() }));
vi.mock('../../app/SessionProvider', () => ({
  useSession: () => ({
    businessPath: (path: string) => `/api/v1/businesses/business-1${path}`,
  }),
}));

afterEach(cleanup);

describe('Persian RTL analytics trace', () => {
  it('renders the six Persian timeline stages and technical values as LTR', async () => {
    document.documentElement.lang = 'fa';
    document.documentElement.dir = 'rtl';
    vi.mocked(request).mockResolvedValue({
      id: 'trace-1',
      createdAt: '2026-08-13T10:00:00Z',
      completedAt: '2026-08-13T10:00:01Z',
      customerMessages: [{ text: 'قیمت چقدر است؟', sentAt: '2026-08-13T10:00:00Z' }],
      conversationContext: [],
      retrieval: {
        raw: [],
        validated: [],
        sentToAi: [],
        citedChunkIds: [],
        chunks: [],
        latencyMs: 10,
      },
      ai: {
        decision: 'HANDOFF',
        answerable: false,
        confidence: 0.7,
        reason: 'دانش کافی نیست',
        answer: null,
        model: 'gpt-test',
        promptVersion: 'prompt-v1',
        tokens: { input: 10, output: 5, total: 15 },
        latencyMs: 20,
      },
      outcome: {
        status: 'HANDOFF',
        reason: 'AI_NOT_ANSWERABLE',
        errorCode: null,
        totalLatencyMs: 30,
      },
      permissions: { canViewPromptInternals: true },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/analytics/traces/trace-1']}>
          <Routes>
            <Route path="analytics/traces/:traceId" element={<AnalyticsTracePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    for (const title of [
      '۱. پیام مشتری',
      '۲. زمینه گفتگو',
      '۳. نتایج بازیابی دانش',
      '۴. داده‌های ارسال‌شده به هوش مصنوعی',
      '۵. تصمیم و پاسخ هوش مصنوعی',
      '۶. نتیجه نهایی',
    ]) {
      expect(await screen.findByRole('heading', { name: title })).toBeVisible();
    }
    expect(screen.getByText('gpt-test')).toHaveClass('ltr');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('renders query rewriter details, exact FAQ Qdrant match, and AI failure diagnostics', async () => {
    vi.mocked(request).mockResolvedValue({
      id: 'trace-2',
      createdAt: '2026-08-13T10:00:00Z',
      completedAt: '2026-08-13T10:00:01Z',
      customerMessages: [{ text: 'امسال', sentAt: '2026-08-13T10:00:00Z' }],
      conversationContext: [],
      queryRewrite: {
        wasRewritten: true,
        rewrittenQuery: 'ثبت‌نام کنکور امسال',
      },
      exactMatch: {
        matched: true,
        score: 0.95,
        questionId: 'q-1',
        questionText: 'شرایط ثبت نام کنکور امسال',
        answerId: 'ans-1',
        answerName: 'کنکور سراسری',
        answerContent: 'هزینه ثبت‌نام ۵ میلیون تومان است.',
      },
      retrieval: {
        raw: [],
        validated: [],
        sentToAi: [],
        citedChunkIds: [],
        chunks: [],
        latencyMs: 5,
      },
      ai: {
        decision: 'COPY_PASTE_EXACT_MATCH',
        answerable: true,
        confidence: 0.95,
        reason: 'EXACT_FAQ_MATCH: شرایط ثبت نام کنکور امسال',
        answer: 'هزینه ثبت‌نام ۵ میلیون تومان است.',
        model: 'deterministic-exact-match',
        promptVersion: 'v1',
        tokens: { input: null, output: null, total: null },
        latencyMs: 0,
      },
      outcome: {
        status: 'SENT',
        reason: null,
        errorCode: null,
        totalLatencyMs: 15,
      },
      permissions: { canViewPromptInternals: true },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/analytics/traces/trace-2']}>
          <Routes>
            <Route path="analytics/traces/:traceId" element={<AnalyticsTracePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Query Rewriter check
    expect(await screen.findByText(/فرآیند بازنویسی هوشمند \(Query Rewriter\)/i)).toBeVisible();
    expect(screen.getByText('ثبت‌نام کنکور امسال')).toBeVisible();

    // Qdrant Exact FAQ Match check
    expect(screen.getByText(/جستجوی پاسخ‌های کپی‌پیست \(FAQ\) در Qdrant/i)).toBeVisible();
    expect(screen.getByText(/انطباق قطعی با سوالات متداول Qdrant/i)).toBeVisible();
    expect(screen.getByText('شرایط ثبت نام کنکور امسال')).toBeVisible();
    expect(
      screen.getAllByText(/هزینه ثبت‌نام ۵ میلیون تومان است\./i)[0],
    ).toBeVisible();
  });

  it('renders prominent failure banner and diagnosis when AI fails to answer or encounters error', async () => {
    vi.mocked(request).mockResolvedValue({
      id: 'trace-3',
      createdAt: '2026-08-13T10:00:00Z',
      completedAt: '2026-08-13T10:00:01Z',
      customerMessages: [{ text: 'سوال ناشناخته', sentAt: '2026-08-13T10:00:00Z' }],
      conversationContext: [],
      queryRewrite: {
        wasRewritten: false,
        rewrittenQuery: null,
      },
      exactMatch: null,
      retrieval: {
        raw: [],
        validated: [],
        sentToAi: [],
        citedChunkIds: [],
        chunks: [],
        latencyMs: 5,
      },
      ai: {
        decision: 'HANDOFF',
        answerable: false,
        confidence: 0.1,
        reason: 'اطلاعات کافی در پایگاه دانش برای پاسخ یافت نشد',
        answer: null,
        model: 'gpt-4o',
        promptVersion: 'v1',
        tokens: { input: 100, output: 20, total: 120 },
        latencyMs: 350,
      },
      outcome: {
        status: 'HANDOFF',
        reason: 'AI_NOT_ANSWERABLE',
        errorCode: null,
        totalLatencyMs: 400,
      },
      permissions: { canViewPromptInternals: true },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/analytics/traces/trace-3']}>
          <Routes>
            <Route path="analytics/traces/:traceId" element={<AnalyticsTracePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Unanswerable diagnosis alert
    expect(
      await screen.findByText(/مدل هوش مصنوعی امکان پاسخ‌گویی به این سوال را نداشت/i),
    ).toBeVisible();
    expect(
      screen.getByText(/اطلاعات کافی در پایگاه دانش برای پاسخ یافت نشد/i),
    ).toBeVisible();
  });
});
