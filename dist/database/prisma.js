import { PrismaClient } from '@prisma/client';
export function createPrismaClient() {
    return new PrismaClient({
        log: process.env['NODE_ENV'] === 'development'
            ? [
                { emit: 'event', level: 'error' },
                { emit: 'event', level: 'warn' },
            ]
            : [{ emit: 'event', level: 'error' }],
    });
}
export async function databaseHealthy(prisma) {
    try {
        await prisma.$queryRaw `SELECT 1`;
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=prisma.js.map