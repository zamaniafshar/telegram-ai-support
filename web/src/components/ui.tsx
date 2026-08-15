import { type ButtonHTMLAttributes, type FormEvent, type ReactNode, useEffect, useId } from 'react';
import { ApiError } from '../core/api';
import { faLabel, statusTone } from '../core/format';

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  return (
    <button className={`button ${variant === 'default' ? '' : variant} ${className}`} {...props} />
  );
}

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`badge ${statusTone(status)}`}>{children ?? faLabel(status)}</span>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export function EmptyState({
  icon = '✓',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingState({
  title = 'در حال دریافت اطلاعات',
  fullPage = false,
}: {
  title?: string;
  fullPage?: boolean;
}) {
  return (
    <main className={fullPage ? 'boot' : 'loading'} aria-busy="true">
      <div className="brand-mark" aria-hidden="true">
        پ
      </div>
      <h1>{title}</h1>
      <span className="spinner" aria-hidden="true" />
    </main>
  );
}

export function FatalState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'خطای پیش‌بینی‌نشده رخ داد.';
  return (
    <main className="fatal">
      <div className="brand-mark">پ</div>
      <h1>ورود به پنل انجام نشد</h1>
      <p>{message}</p>
    </main>
  );
}

export function QueryState({
  pending,
  error,
  children,
}: {
  pending: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (pending) return <LoadingState />;
  if (error) {
    const denied = error instanceof ApiError && [401, 403].includes(error.status);
    return (
      <EmptyState
        icon="!"
        title={denied ? 'دسترسی مجاز نیست' : 'امکان نمایش این بخش وجود ندارد'}
        description={error instanceof Error ? error.message : 'دوباره تلاش کنید.'}
      />
    );
  }
  return <>{children}</>;
}

export function SearchForm({
  initialValue = '',
  placeholder,
  onSearch,
}: {
  initialValue?: string;
  placeholder: string;
  onSearch: (value: string) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('query');
    onSearch(typeof value === 'string' ? value.trim() : '');
  };
  return (
    <form className="search-wrap" onSubmit={submit}>
      <input
        className="search-input"
        name="query"
        type="search"
        defaultValue={initialValue}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </form>
  );
}

export function Dialog({
  title,
  description,
  children,
  onClose,
  placement = 'bottom',
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  placement?: 'top' | 'bottom';
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div
      className={`sheet-backdrop ${placement === 'top' ? 'sheet-backdrop-top' : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className={`sheet ${placement === 'top' ? 'sheet-top' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h3 id={titleId}>{title}</h3>
        <p id={descriptionId}>{description}</p>
        {children}
      </section>
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}
