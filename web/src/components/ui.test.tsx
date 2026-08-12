// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge, SearchForm } from './ui';

afterEach(cleanup);

describe('shared Mini App UI', () => {
  it('renders translated status with its semantic tone', () => {
    render(<Badge status="READY" />);
    expect(screen.getByText('آماده استفاده')).toHaveClass('badge', 'success');
  });

  it('submits a trimmed search query through an accessible form', async () => {
    const onSearch = vi.fn<(value: string) => void>();
    const user = userEvent.setup();
    render(<SearchForm placeholder="جستجو در گفتگوها" onSearch={onSearch} />);

    await user.type(screen.getByRole('searchbox'), '  مشتری  ');
    await user.keyboard('{Enter}');

    expect(onSearch).toHaveBeenCalledWith('مشتری');
  });
});
