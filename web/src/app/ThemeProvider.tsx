import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { telegram } from '../core/telegram';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const storageKey = 'mini-app-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function preferredTheme(): Theme {
  return (
    storedTheme() ??
    telegram?.colorScheme ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#111923' : '#2481cc');
  telegram?.setHeaderColor?.(theme === 'dark' ? '#182330' : '#ffffff');
  telegram?.setBackgroundColor?.(theme === 'dark' ? '#111923' : '#f7f9fc');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(preferredTheme);

  useLayoutEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (storedTheme()) return;
    const syncTelegramTheme = () => setTheme(telegram?.colorScheme ?? preferredTheme());
    telegram?.onEvent?.('themeChanged', syncTelegramTheme);
    return () => telegram?.offEvent?.('themeChanged', syncTelegramTheme);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme: () => {
        setTheme((current) => {
          const next = current === 'dark' ? 'light' : 'dark';
          try {
            window.localStorage.setItem(storageKey, next);
          } catch {
            // The selected theme still applies for this session when storage is unavailable.
          }
          return next;
        });
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
