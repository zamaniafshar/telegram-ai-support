import { AdminRole, type Admin, type PrismaClient } from '@prisma/client';
export declare class AdminAuthorizer {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    requireAdmin(telegramUserId: bigint, minimumRole?: AdminRole): Promise<Admin>;
}
