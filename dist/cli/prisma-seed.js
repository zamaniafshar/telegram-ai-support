import { AdminRole, PrismaClient } from '@prisma/client';
import { loadConfig } from '../config/env.js';
import { loadLocalEnvFile } from '../config/load-env-file.js';
import { deterministicUuid, newId } from '../utils/ids.js';
loadLocalEnvFile();
const prisma = new PrismaClient();
const config = loadConfig();
const businessId = process.env['SEED_BUSINESS_ACCOUNT_ID'] ?? deterministicUuid('default-business-account');
const businessName = process.env['SEED_BUSINESS_ACCOUNT_NAME'] ?? 'پشتیبانی';
await prisma.$transaction(async (tx) => {
    const business = await tx.businessAccount.upsert({
        where: { id: businessId },
        create: { id: businessId, name: businessName },
        update: { name: businessName },
    });
    const owner = await tx.admin.upsert({
        where: { telegramUserId: config.telegram.ownerId },
        create: {
            id: newId(),
            telegramUserId: config.telegram.ownerId,
            role: AdminRole.OWNER,
            displayName: 'Owner',
        },
        update: { role: AdminRole.OWNER, isActive: true },
    });
    await tx.adminBusinessAccount.upsert({
        where: {
            adminId_businessAccountId: {
                adminId: owner.id,
                businessAccountId: business.id,
            },
        },
        create: { adminId: owner.id, businessAccountId: business.id },
        update: {},
    });
    for (const telegramUserId of config.telegram.initialAdminIds) {
        const admin = await tx.admin.upsert({
            where: { telegramUserId },
            create: { id: newId(), telegramUserId, role: AdminRole.ADMIN },
            update: { isActive: true },
        });
        await tx.adminBusinessAccount.upsert({
            where: {
                adminId_businessAccountId: {
                    adminId: admin.id,
                    businessAccountId: business.id,
                },
            },
            create: { adminId: admin.id, businessAccountId: business.id },
            update: {},
        });
    }
});
await prisma.$disconnect();
console.log(`Seeded business account ${businessId} and authorized administrators.`);
//# sourceMappingURL=prisma-seed.js.map