import { describe, expect, it, vi } from 'vitest';
import { tryAcquireConversationLease } from '../src/workers/conversation-lease.js';

describe('per-conversation concurrency control', () => {
  it('allows only one worker to acquire the same conversation concurrently', async () => {
    let owner: string | null = null;
    const updateMany = vi.fn(async (input: { data: { processingLeaseOwner: string } }) => {
      if (owner !== null && owner !== input.data.processingLeaseOwner) return { count: 0 };
      owner = input.data.processingLeaseOwner;
      return { count: 1 };
    });
    const prisma = { conversation: { updateMany } };
    const [first, second] = await Promise.all([
      tryAcquireConversationLease(prisma as never, 'conversation-1', 'worker-a', 60_000),
      tryAcquireConversationLease(prisma as never, 'conversation-1', 'worker-b', 60_000),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});
