import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MiniAppAuthService, verifyTelegramMiniAppData } from '../src/mini-app/auth.js';
import { testConfig } from './helpers.js';

const token = '123456:admin-token';

function signedInitData(authDate: number, userId = 123456789): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAExampleQuery',
    user: JSON.stringify({
      id: userId,
      first_name: 'مدیر',
      last_name: 'نمونه',
      username: 'example_admin',
    }),
  });
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
}

describe('Telegram Mini App authentication', () => {
  it('verifies a fresh Telegram-signed payload and preserves the Telegram ID as bigint', () => {
    const now = new Date('2026-08-12T10:00:00.000Z');
    const verified = verifyTelegramMiniAppData(
      signedInitData(Math.floor(now.getTime() / 1_000)),
      token,
      300,
      now,
    );

    expect(verified.telegramUserId).toBe(123456789n);
    expect(verified.displayName).toBe('مدیر نمونه');
    expect(verified.queryId).toBe('AAExampleQuery');
  });

  it('rejects tampered and expired payloads', () => {
    const now = new Date('2026-08-12T10:00:00.000Z');
    const current = Math.floor(now.getTime() / 1_000);
    const tampered = signedInitData(current).replace('example_admin', 'attacker');

    expect(() => verifyTelegramMiniAppData(tampered, token, 300, now)).toThrow(
      /authentication data is invalid/,
    );
    expect(() => verifyTelegramMiniAppData(signedInitData(current - 301), token, 300, now)).toThrow(
      /expired/,
    );
  });

  it('uses an HttpOnly host-only secure cookie and never exposes a database token', () => {
    const service = new MiniAppAuthService({} as never, testConfig());
    const cookie = service.sessionCookie('opaque-token');

    expect(cookie).toContain('__Host-tma_session=opaque-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Domain=');
  });

  it('uses a separate localhost cookie for the explicit development bypass', () => {
    const service = new MiniAppAuthService(
      {} as never,
      testConfig({ NODE_ENV: 'development', MINI_APP_DEV_ADMIN_ID: '123456789' }),
    );
    const cookie = service.sessionCookie('local-token', true);
    expect(cookie).toContain('tma_dev_session=local-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Secure');
  });

  it('refuses development exchange unless the bypass is explicitly configured', async () => {
    const service = new MiniAppAuthService({} as never, testConfig());
    await expect(service.developmentExchange()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
