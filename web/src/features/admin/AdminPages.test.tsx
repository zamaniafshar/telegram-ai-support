// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MorePage } from './AdminPages';

const mockHasCapability = vi.fn();

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

describe('MorePage navigation', () => {
  it('renders analytics link when user has analytics:read capability', () => {
    mockHasCapability.mockImplementation((cap: string) => cap === 'analytics:read');

    render(
      <MemoryRouter>
        <MorePage />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /تحلیل پاسخ‌های هوشمند/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/analytics');
    expect(screen.getByText('بررسی کیفیت و ردیابی پاسخ‌های AI')).toBeInTheDocument();
  });

  it('hides analytics link when user lacks analytics:read capability', () => {
    mockHasCapability.mockReturnValue(false);

    render(
      <MemoryRouter>
        <MorePage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /تحلیل پاسخ‌های هوشمند/i })).not.toBeInTheDocument();
  });
});
