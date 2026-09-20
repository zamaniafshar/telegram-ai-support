import { AdminRole } from '@prisma/client';
import { AuthorizationError } from '../utils/errors.js';
const roleRank = {
    [AdminRole.SUPPORT]: 1,
    [AdminRole.ADMIN]: 2,
    [AdminRole.OWNER]: 3,
};
export function requireRole(context, minimum) {
    if (roleRank[context.admin.role] < roleRank[minimum])
        throw new AuthorizationError();
}
export function requireOwner(context) {
    if (context.admin.role !== AdminRole.OWNER)
        throw new AuthorizationError();
}
export function requireBusiness(context, businessAccountId) {
    const access = context.businessAccess.find((item) => item.businessAccountId === businessAccountId && item.businessAccount.isActive);
    if (!access)
        throw new AuthorizationError();
    return access.businessAccount;
}
export function capabilities(context) {
    const common = [
        'dashboard:read',
        'handoff:read',
        'handoff:manage',
        'conversation:read',
        'connection:read',
        'health:read',
        'notification:read',
        'settings:read',
        'analytics:read',
    ];
    if (context.admin.role !== AdminRole.SUPPORT) {
        common.push('knowledge:manage', 'audit:read', 'diagnostics:read', 'settings:write', 'analytics:prompt-internals');
    }
    if (context.admin.role === AdminRole.OWNER) {
        common.push('admin:manage');
    }
    return common;
}
//# sourceMappingURL=authorization.js.map