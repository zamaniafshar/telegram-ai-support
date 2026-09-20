import { AdminRole } from '@prisma/client';
import { AuthorizationError } from '../utils/errors.js';
const roleRank = {
    [AdminRole.SUPPORT]: 1,
    [AdminRole.ADMIN]: 2,
    [AdminRole.OWNER]: 3,
};
export class AdminAuthorizer {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async requireAdmin(telegramUserId, minimumRole = AdminRole.SUPPORT) {
        const admin = await this.prisma.admin.findUnique({ where: { telegramUserId } });
        if (!admin?.isActive || roleRank[admin.role] < roleRank[minimumRole]) {
            throw new AuthorizationError();
        }
        return admin;
    }
}
//# sourceMappingURL=admin-authorization.js.map