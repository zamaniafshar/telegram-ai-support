import { millisecondsFrom } from '../utils/time.js';
export async function tryAcquireConversationLease(prisma, conversationId, workerId, leaseMs, now = new Date()) {
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
//# sourceMappingURL=conversation-lease.js.map