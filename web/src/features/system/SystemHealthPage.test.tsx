// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../../core/api';
import { SystemHealthPage } from './SystemHealthPage';

const mockHasCapability = vi.fn();

vi.mock('../../core/api', () => ({ request: vi.fn() }));
vi.mock('../../app/SessionProvider', () => ({
  useSession: () => ({
    hasCapability: mockHasCapability,
    businessPath: (path: string) => `/api/v1/businesses/business-1${path}`,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithClient(initialRoute = '/system') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/system" element={<SystemHealthPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SystemHealthPage (merged system, connection & diagnostics)', () => {
  beforeEach(() => {
    mockHasCapability.mockImplementation((cap: string) => cap === 'diagnostics:read');

    vi.mocked(request).mockImplementation((url: string) => {
      if (url.endsWith('/system')) {
        return Promise.resolve({
          ready: true,
          checks: {
            process: true,
            configuration: true,
            mysql: true,
            qdrant: true,
            businessWebhook: true,
            adminWebhook: true,
          },
          queues: {
            indexing: [{ status: 'COMPLETED', _count: 12 }],
            conversations: [{ status: 'PENDING', _count: 3 }],
            notifications: [],
          },
          credit: {
            lastCheckedAt: '2026-09-22T00:00:00Z',
            isLow: false,
          },
        });
      }
      if (url.endsWith('/connections')) {
        return Promise.resolve([
          {
            id: 'conn-1',
            businessConnectionId: 'bc-12345',
            enabled: true,
            canReply: true,
            connectedAt: '2026-09-20T12:00:00Z',
            updatedAt: '2026-09-21T18:00:00Z',
          },
        ]);
      }
      if (url.endsWith('/diagnostics')) {
        return Promise.resolve({
          health: {
            ready: true,
            checks: { process: true, mysql: true },
          },
          queues: {
            indexing: [{ status: 'COMPLETED', _count: 12 }],
            conversations: [{ status: 'PENDING', _count: 3 }],
          },
          logs: {
            byLevel: { INFO: 42, ERROR: 2 },
            byCategory: { TELEGRAM: 30, AI: 14 },
            topErrors: [
              {
                errorCode: 'TELEGRAM_RATE_LIMIT',
                count: 2,
                messageFa: 'محدودیت نرخ ارسال پیام تلگرام',
                fix: 'کمی صبر کنید تا پنجره زمانی آزاد شود',
              },
            ],
          },
          generatedAt: '2026-09-22T00:10:00Z',
        });
      }
      return Promise.reject(new Error(`Unhandled route: ${url}`));
    });
  });

  it('renders the unified page header and status notice', async () => {
    renderWithClient();

    expect(
      await screen.findByRole('heading', { name: 'سلامت و عیب‌یابی سامانه' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('سامانه و اتصال تجاری آماده پاسخ‌گویی است')).toBeInTheDocument();
  });

  it('renders business connection details in the connection section', async () => {
    renderWithClient();

    expect(await screen.findByText('حساب تجاری تلگرام')).toBeInTheDocument();
    expect(screen.getByText('آماده پاسخ‌گویی')).toBeInTheDocument();
    expect(screen.getByText('bc-12345')).toBeInTheDocument();
  });

  it('renders core infrastructure services and queues', async () => {
    renderWithClient();

    expect(await screen.findByText('پایگاه داده (MySQL)')).toBeInTheDocument();
    expect(screen.getByText('موتور برداری دانش (Qdrant)')).toBeInTheDocument();
    expect(screen.getByText('پردازش و نمایه‌سازی دانش')).toBeInTheDocument();
  });

  it('renders diagnostics top errors and log distribution for admins', async () => {
    renderWithClient();

    expect(await screen.findByText('TELEGRAM_RATE_LIMIT')).toBeInTheDocument();
    expect(screen.getByText('محدودیت نرخ ارسال پیام تلگرام')).toBeInTheDocument();
    expect(
      screen.getByText('راهکار رفع: کمی صبر کنید تا پنجره زمانی آزاد شود'),
    ).toBeInTheDocument();
    expect(screen.getByText('لاگ‌های سامانه')).toBeInTheDocument();
  });

  it('switches tabs correctly via segmented navigation buttons', async () => {
    const user = userEvent.setup();
    renderWithClient();

    const connectionTab = await screen.findByRole('tab', { name: /اتصال تجاری/i });
    await user.click(connectionTab);

    expect(screen.getByRole('tab', { name: /اتصال تجاری/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.queryByRole('heading', { name: 'سرویس‌های اصلی و صف‌های پردازش' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'اتصال حساب تجاری تلگرام' })).toBeInTheDocument();
  });

  it('hides diagnostics tab and section when user lacks diagnostics:read capability', async () => {
    mockHasCapability.mockReturnValue(false);
    renderWithClient();

    expect(
      await screen.findByRole('heading', { name: 'سلامت و عیب‌یابی سامانه' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /عیب‌یابی و لاگ‌ها/i })).not.toBeInTheDocument();
    expect(screen.queryByText('لاگ‌های سامانه')).not.toBeInTheDocument();
  });
});
