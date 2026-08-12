import { AdminRole } from '@prisma/client';
import type { MiniAppSessionContext } from './auth.js';
import { AuthorizationError } from '../utils/errors.js';

const roleRank: Readonly<Record<AdminRole, number>> = {
  [AdminRole.SUPPORT]: 1,
  [AdminRole.ADMIN]: 2,
  [AdminRole.OWNER]: 3,
};

export function requireRole(context: MiniAppSessionContext, minimum: AdminRole): void {
  if (roleRank[context.admin.role] < roleRank[minimum]) throw new AuthorizationError();
}

export function requireOwner(context: MiniAppSessionContext): void {
  if (context.admin.role !== AdminRole.OWNER) throw new AuthorizationError();
}

export function requireBusiness(context: MiniAppSessionContext, businessAccountId: string) {
  const access = context.businessAccess.find(
    (item) => item.businessAccountId === businessAccountId && item.businessAccount.isActive,
  );
  if (!access) throw new AuthorizationError();
  return access.businessAccount;
}

export function capabilities(context: MiniAppSessionContext): string[] {
  const common = [
    'dashboard:read',
    'handoff:read',
    'handoff:manage',
    'conversation:read',
    'connection:read',
    'health:read',
    'notification:read',
    'settings:read',
  ];
  if (context.admin.role !== AdminRole.SUPPORT) {
    common.push('knowledge:manage', 'audit:read', 'diagnostics:read', 'settings:write');
  }
  if (context.admin.role === AdminRole.OWNER) {
    common.push('admin:manage');
  }
  return common;
}
