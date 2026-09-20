import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { faLabel } from '../core/format';
import { telegram } from '../core/telegram';
import { useSession } from './SessionProvider';
import { useTheme } from './ThemeProvider';

const primary = [
  ['/overview', '⌂', 'نمای کلی'],
  ['/handoffs', '◉', 'گفتگوها'],
  ['/ai-backlog', '◷', 'پیام‌های در انتظار'],
] as const;

export function AppShell() {
  const { session, businessId, setBusinessId, hasCapability } = useSession();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = [
    ...primary,
    ...(hasCapability('analytics:read')
      ? [['/analytics', '⌁', 'تحلیل پاسخ‌های هوشمند'] as const]
      : []),
    ...(hasCapability('knowledge:manage') ? [['/knowledge', '▤', 'مدیریت دانش'] as const] : []),
    ['/connections', '⌁', 'اتصال تجاری'] as const,
    ['/system', '♡', 'سلامت سامانه'] as const,
    ...(hasCapability('admin:manage') ? [['/admins', '♙', 'مدیران'] as const] : []),
    ...(hasCapability('audit:read') ? [['/audit', '◷', 'فعالیت‌ها'] as const] : []),
    ['/notifications', '♢', 'اعلان‌ها'] as const,
    ...(hasCapability('settings:read') ? [['/settings', '⚙', 'تنظیمات'] as const] : []),
  ];

  useEffect(() => {
    const button = telegram?.BackButton;
    if (!button) return;
    const root = location.pathname === '/overview';
    if (root) button.hide();
    else button.show();
    const goBack = () => void navigate(-1);
    button.onClick(goBack);
    return () => button.offClick(goBack);
  }, [location.pathname, navigate]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">پ</div>
          <span>پنل پشتیبانی</span>
        </div>
        <nav className="side-nav" aria-label="ناوبری اصلی">
          {navigation.map(([path, icon, label]) => (
            <NavLink key={path} className="nav-item" to={path}>
              <span aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-admin">
          <strong>{session.admin.displayName ?? 'مدیر سامانه'}</strong>
          <span>{faLabel(session.admin.role)}</span>
        </div>
      </aside>
      <div className="app-column">
        {session.developmentMode && (
          <div className="dev-banner" role="status">
            حالت توسعه — ورود تلگرام دور زده شده است
          </div>
        )}
        <header className="topbar">
          <div className="topbar-brand">
            <strong>پنل مدیریت پشتیبانی</strong>
          </div>
          <div className="topbar-actions">
            {session.businesses.length > 1 && (
              <>
                <label className="sr-only" htmlFor="business-select">
                  کسب‌وکار
                </label>
                <select
                  id="business-select"
                  className="business-select"
                  value={businessId}
                  onChange={(event) => {
                    setBusinessId(event.target.value);
                    telegram?.HapticFeedback?.selectionChanged();
                  }}
                >
                  {session.businesses.map((business) => (
                    <option key={business.id} value={business.id}>
                      {business.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              className="theme-toggle"
              type="button"
              aria-label={theme === 'dark' ? 'فعال‌سازی تم روشن' : 'فعال‌سازی تم تاریک'}
              title={theme === 'dark' ? 'تم روشن' : 'تم تاریک'}
              onClick={toggleTheme}
            >
              <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
            </button>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
      <nav className="bottom-nav" aria-label="ناوبری اصلی">
        {[...primary, ['/more', '•••', 'بیشتر'] as const].map(([path, icon, label]) => (
          <NavLink key={path} className="nav-item" to={path}>
            <span aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
