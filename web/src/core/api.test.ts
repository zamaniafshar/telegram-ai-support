// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, setCsrfToken } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken('');
});

describe('Mini App API client', () => {
  it('adds CSRF and idempotency protection to mutations', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf-token');

    await request('/api/v1/resource', { method: 'POST', body: JSON.stringify({ value: 1 }) });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
    expect(headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(init?.credentials).toBe('same-origin');
  });

  it('does not attach mutation headers to reads', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf-token');

    await request('/api/v1/resource');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has('X-CSRF-Token')).toBe(false);
    expect(headers.has('Idempotency-Key')).toBe(false);
  });
});
