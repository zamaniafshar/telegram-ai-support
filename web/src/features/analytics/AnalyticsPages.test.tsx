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
});
