// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DraftEditorPage, KnowledgePage } from './KnowledgePages';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockRequest = vi.fn();
vi.mock('../../core/api', () => ({
  request: (...args: unknown[]) => mockRequest(...args) as Promise<unknown>,
  jsonBody: (val: unknown) => JSON.stringify(val),
}));

const mockToast = vi.fn();
vi.mock('../../app/ToastProvider', () => ({
  useToast: () => mockToast,
}));

vi.mock('../../app/ConfirmationProvider', () => ({
  useConfirmation: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../../app/SessionProvider', () => ({
  useSession: () => ({
    businessPath: (path: string) => `/api/v1/businesses/business-1${path}`,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('KnowledgePage "تعریف محتوای جدید" button', () => {
  it('navigates directly to /knowledge/new when clicked', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    mockRequest.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/knowledge') && (!init || init.method === 'GET' || !init.method)) {
        return Promise.resolve({
          published: [],
          drafts: [],
          exactAnswers: [],
        });
      }
      return Promise.reject(new Error(`Unhandled request to ${url}`));
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <KnowledgePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const buttons = await screen.findAllByRole('button', { name: /تعریف محتوای جدید/i });
    expect(buttons[0]).toBeInTheDocument();

    await userEvent.click(buttons[0]);

    expect(mockNavigate).toHaveBeenCalledWith('/knowledge/new');
  });

  it('navigates to /knowledge/new?type=exact when exact tab is active and clicked', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    mockRequest.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/knowledge') && (!init || init.method === 'GET' || !init.method)) {
        return Promise.resolve({
          published: [],
          drafts: [],
          exactAnswers: [],
        });
      }
      return Promise.reject(new Error(`Unhandled request to ${url}`));
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <KnowledgePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const exactTab = await screen.findByRole('button', { name: /پاسخ‌های کپی‌پیست FAQ/i });
    await userEvent.click(exactTab);

    const buttons = await screen.findAllByRole('button', { name: /تعریف محتوای جدید/i });
    await userEvent.click(buttons[0]);

    expect(mockNavigate).toHaveBeenCalledWith('/knowledge/new?type=exact');
  });
});

describe('DraftEditorPage at /knowledge/new', () => {
  it('renders creation form immediately without fetching draft details', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/knowledge/new']}>
          <Routes>
            <Route path="/knowledge/new" element={<DraftEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('تعریف محتوای جدید')).toBeInTheDocument();
    expect(screen.getByText(/📘 پایگاه دانش \(RAG\)/i)).toBeInTheDocument();
    expect(screen.getByText(/⚡ پاسخ مستقیم و کپی‌پیست \(FAQ\)/i)).toBeInTheDocument();
    expect(mockRequest).not.toHaveBeenCalledWith(
      expect.stringContaining('/knowledge/drafts/new'),
      expect.anything(),
    );
  });

  it('allows switching to Exact Answer mode and submitting a verbatim FAQ', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    mockRequest.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/exact-answers') && init?.method === 'POST') {
        return Promise.resolve({
          id: 'exact-123',
          name: 'شماره حساب',
          content: 'شماره کارت ما ۶۰۳۷۹۹',
          questions: [{ id: 'q-1', questionText: 'شماره کارت بدید' }],
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      return Promise.reject(new Error(`Unhandled request to ${url}`));
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/knowledge/new']}>
          <Routes>
            <Route path="/knowledge/new" element={<DraftEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const exactCard = await screen.findByText(/⚡ پاسخ مستقیم و کپی‌پیست \(FAQ\)/i);
    await userEvent.click(exactCard);

    const titleInput = screen.getByPlaceholderText(/شماره شبا و کارت فروشگاه/i);
    const questionsTextarea = screen.getByPlaceholderText(/شماره حساب برای واریز چیه/i);
    const contentTextarea = screen.getByPlaceholderText(/متن کامل و دقیق پاسخ را بنویسید/i);

    await userEvent.type(titleInput, 'شماره حساب');
    await userEvent.type(questionsTextarea, 'شماره کارت بدید');
    await userEvent.type(contentTextarea, 'شماره کارت ما ۶۰۳۷۹۹');

    const submitBtn = screen.getByRole('button', { name: /ذخیره پاسخ کپی‌پیست/i });
    await userEvent.click(submitBtn);

    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/businesses/business-1/exact-answers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'شماره حساب',
          content: 'شماره کارت ما ۶۰۳۷۹۹',
          questions: ['شماره کارت بدید'],
          isActive: true,
        }),
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/knowledge/exact-answers/exact-123', {
      replace: true,
    });
  });

  it('allows saving a knowledge draft when isNew', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    mockRequest.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/knowledge/drafts') && init?.method === 'POST') {
        return Promise.resolve({
          id: 'created-draft-999',
          title: '',
          description: '',
          revision: 1,
        });
      }
      if (url.includes('/knowledge/drafts/created-draft-999') && init?.method === 'PATCH') {
        return Promise.resolve({
          id: 'created-draft-999',
          title: 'شرایط گارانتی',
          description: 'گارانتی به مدت ۶ ماه معتبر است.',
          revision: 2,
        });
      }
      return Promise.reject(new Error(`Unhandled request to ${url}`));
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/knowledge/new']}>
          <Routes>
            <Route path="/knowledge/new" element={<DraftEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const titleInput = screen.getByPlaceholderText(/شرایط بازگشت وجه/i);
    const descTextarea = screen.getByPlaceholderText(/اطلاعات دقیق و قابل استناد/i);

    await userEvent.type(titleInput, 'شرایط گارانتی');
    await userEvent.type(descTextarea, 'گارانتی به مدت ۶ ماه معتبر است.');

    const saveBtn = screen.getByRole('button', { name: /ذخیره پیش‌نویس/i });
    await userEvent.click(saveBtn);

    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/businesses/business-1/knowledge/drafts',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/businesses/business-1/knowledge/drafts/created-draft-999',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/knowledge/drafts/created-draft-999', {
      replace: true,
    });
  });
});
