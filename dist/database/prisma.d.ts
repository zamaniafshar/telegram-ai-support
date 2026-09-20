import { PrismaClient } from '@prisma/client';
export declare function createPrismaClient(): PrismaClient;
export declare function databaseHealthy(prisma: PrismaClient): Promise<boolean>;
