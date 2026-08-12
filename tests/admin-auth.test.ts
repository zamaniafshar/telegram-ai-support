import { AdminRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AdminAuthorizer } from '../src/security/admin-authorization.js';

describe('admin authorization', () => {
  it('rejects unknown and inactive Telegram users', async () => {
    const authorizer = new AdminAuthorizer({
      admin: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);
    await expect(authorizer.requireAdmin(123n)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('enforces role hierarchy for the bot entry point', async () => {
    const support = {
      id: 'support',
      telegramUserId: 1n,
      displayName: null,
      role: AdminRole.SUPPORT,
      isActive: true,
      locale: 'fa',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const authorizer = new AdminAuthorizer({
      admin: { findUnique: vi.fn().mockResolvedValue(support) },
    } as never);
    await expect(authorizer.requireAdmin(1n, AdminRole.ADMIN)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
