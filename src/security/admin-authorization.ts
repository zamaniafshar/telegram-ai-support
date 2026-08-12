import { AdminRole, type Admin, type PrismaClient } from '@prisma/client';
import { AuthorizationError } from '../utils/errors.js';

const roleRank: Readonly<Record<AdminRole, number>> = {
  [AdminRole.SUPPORT]: 1,
  [AdminRole.ADMIN]: 2,
  [AdminRole.OWNER]: 3,
};

export class AdminAuthorizer {
  constructor(private readonly prisma: PrismaClient) {}

  async requireAdmin(
    telegramUserId: bigint,
    minimumRole: AdminRole = AdminRole.SUPPORT,
  ): Promise<Admin> {
    const admin = await this.prisma.admin.findUnique({ where: { telegramUserId } });
    if (!admin?.isActive || roleRank[admin.role] < roleRank[minimumRole]) {
      throw new AuthorizationError();
    }
    return admin;
  }
}
