// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';

function ThemeControl() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('color-scheme');
});

describe('Mini App theme', () => {
  it('toggles to dark mode and remembers the device preference', async () => {
    window.localStorage.setItem('mini-app-theme', 'light');
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    );

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.click(screen.getByRole('button', { name: 'light' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('mini-app-theme')).toBe('dark');
  });

  it('restores a previously selected dark theme', () => {
    window.localStorage.setItem('mini-app-theme', 'dark');
    render(
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: 'dark' })).toBeVisible();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
