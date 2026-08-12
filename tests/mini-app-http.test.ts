import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/http/server.js';
import { silentLogger, testConfig } from './helpers.js';

const apps: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Mini App HTTP delivery', () => {
  it('serves the RTL application shell for a deep link with a restrictive Telegram-compatible CSP', async () => {
    const app = await buildServer(
      testConfig(),
      {
        health: { readiness: async () => ({ ready: true }) },
        miniAppAuth: {},
        miniAppManagement: {},
      } as never,
      silentLogger,
    );
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/mini-app/handoffs/conversation-1?business=business-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<html lang="fa" dir="rtl">');
    expect(response.body).toMatch(/\/mini-app\/assets\/index-[^"']+\.js/);
    expect(response.headers['content-security-policy']).toContain(
      "script-src 'self' https://telegram.org",
    );
    expect(response.headers['content-security-policy']).not.toContain("'unsafe-inline'");
  });

  it('serves JavaScript and CSS with explicit safe content types', async () => {
    const app = await buildServer(
      testConfig(),
      {
        health: { readiness: async () => ({ ready: true }) },
        miniAppAuth: {},
        miniAppManagement: {},
      } as never,
      silentLogger,
    );
    apps.push(app);

    const index = await app.inject({ method: 'GET', url: '/mini-app/' });
    const scriptPath = /src="([^"]+\.js)"/.exec(index.body)?.[1];
    const stylePath = /href="([^"]+\.css)"/.exec(index.body)?.[1];
    expect(scriptPath).toBeDefined();
    expect(stylePath).toBeDefined();
    if (!scriptPath || !stylePath) throw new Error('Built Mini App assets are missing');
    const [script, style] = await Promise.all([
      app.inject({ method: 'GET', url: scriptPath }),
      app.inject({ method: 'GET', url: stylePath }),
    ]);
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(style.statusCode).toBe(200);
    expect(style.headers['content-type']).toContain('text/css');
  });
});
