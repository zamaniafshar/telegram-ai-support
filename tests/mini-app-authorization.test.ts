import { AdminRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  capabilities,
  requireBusiness,
  requireOwner,
  requireRole,
} from '../src/mini-app/authorization.js';

function context(role: AdminRole, businessIds = ['business-1']) {
  return {
    sessionId: 'session-1',
    admin: { id: 'admin-1', role, isActive: true },
    businessAccess: businessIds.map((businessAccountId) => ({
      adminId: 'admin-1',
      businessAccountId,
      businessAccount: { id: businessAccountId, isActive: true, name: businessAccountId },
    })),
  } as never;
}

describe('Mini App tenant and role authorization', () => {
  it('denies cross-business object access before a database query can be built', () => {
    expect(() => requireBusiness(context(AdminRole.ADMIN), 'business-2')).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
  });

  it('allows support handoff operations but not knowledge, audit, or admin management', () => {
    const support = context(AdminRole.SUPPORT);
    expect(capabilities(support)).toEqual(
      expect.arrayContaining(['handoff:read', 'handoff:manage', 'conversation:read']),
    );
    expect(capabilities(support)).not.toEqual(
      expect.arrayContaining(['knowledge:manage', 'audit:read', 'admin:manage']),
    );
    expect(capabilities(support)).toContain('settings:read');
    expect(capabilities(support)).not.toContain('settings:write');
    expect(() => requireRole(support, AdminRole.ADMIN)).toThrow();
  });

  it('reserves role and authorization management for the owner', () => {
    expect(() => requireOwner(context(AdminRole.ADMIN))).toThrow();
    expect(() => requireOwner(context(AdminRole.OWNER))).not.toThrow();
    expect(capabilities(context(AdminRole.OWNER))).toEqual(
      expect.arrayContaining([
        'knowledge:manage',
        'admin:manage',
        'settings:read',
        'settings:write',
      ]),
    );
  });
});
