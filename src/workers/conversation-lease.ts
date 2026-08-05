import type { PrismaClient } from '@prisma/client';
import { millisecondsFrom } from '../utils/time.js';

export async function tryAcquireConversationLease(
  prisma: Pick<PrismaClient, 'conversation'>,
  conversationId: string,
  workerId: string,
  leaseMs: number,
  now = new Date(),
): Promise<boolean> {
  const updated = await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      OR: [
        { processingLeaseExpiresAt: null },
        { processingLeaseExpiresAt: { lt: now } },
        { processingLeaseOwner: workerId },
      ],
    },
    data: {
      processingLeaseOwner: workerId,
      processingLeaseExpiresAt: millisecondsFrom(now, leaseMs),
    },
  });
  return updated.count === 1;
}
