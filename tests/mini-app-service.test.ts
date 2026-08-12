import { AdminRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MiniAppManagementService } from '../src/mini-app/service.js';
import { testConfig } from './helpers.js';

describe('Mini App management service', () => {
  it('returns a JSON-safe dashboard business projection instead of the raw database record', async () => {
    const business = {
      id: 'business-1',
      name: 'پشتیبانی',
      defaultLocale: 'fa',
      isActive: true,
      telegramAccountUserId: 123456789n,
    };
    const prisma = {
      handoff: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      conversation: { count: vi.fn().mockResolvedValue(0) },
      businessConnection: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new MiniAppManagementService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      testConfig(),
    );
    const context = {
      admin: { role: AdminRole.SUPPORT },
      businessAccess: [{ businessAccountId: business.id, businessAccount: business }],
    };

    const dashboard = await service.dashboard(context as never, business.id);

    expect(dashboard.business).toEqual({ id: business.id, name: business.name, locale: 'fa' });
    expect(() => JSON.stringify(dashboard)).not.toThrow();
    expect(dashboard.business).not.toHaveProperty('telegramAccountUserId');
  });
});
