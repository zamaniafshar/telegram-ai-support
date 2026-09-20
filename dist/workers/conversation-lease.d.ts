import type { PrismaClient } from '@prisma/client';
export declare function tryAcquireConversationLease(prisma: Pick<PrismaClient, 'conversation'>, conversationId: string, workerId: string, leaseMs: number, now?: Date): Promise<boolean>;
