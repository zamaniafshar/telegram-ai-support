import type { Session } from './types';

interface Envelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

let csrfToken = '';

export function setCsrfToken(value: string): void {
  csrfToken = value;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const mutation = method !== 'GET' && method !== 'HEAD';
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (mutation && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
    headers.set('Idempotency-Key', crypto.randomUUID());
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as Envelope<T> & ErrorEnvelope;
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message ?? 'عملیات انجام نشد. دوباره تلاش کنید.',
      response.status,
      payload.error?.code,
    );
  }
  return payload.data;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export async function authenticate(): Promise<Session> {
  try {
    const session = await request<Session>('/api/v1/session');
    setCsrfToken(session.csrfToken);
    return session;
  } catch {
    const initData = window.Telegram?.WebApp.initData;
    const session = initData
      ? await request<Session>('/api/v1/auth/telegram', {
          method: 'POST',
          body: jsonBody({ initData }),
        })
      : await request<Session>('/api/v1/auth/development', { method: 'POST' });
    setCsrfToken(session.csrfToken);
    return session;
  }
}
