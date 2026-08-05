import { AdminRole, ConversationMode, HandoffStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { HandoffService } from '../src/handoffs/service.js';
import { silentLogger, testConfig } from './helpers.js';

const admin = {
  id: 'admin-1',
  telegramUserId: 1n,
  displayName: null,
  role: AdminRole.ADMIN,
  isActive: true,
  locale: 'fa',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const conversation = {
  id: 'conversation-1',
  businessAccountId: 'business-1',
  customerId: 'customer-1',
  telegramChatId: 1n,
  mode: ConversationMode.HUMAN,
  lastCustomerMessageAt: new Date(),
  telegramReplyWindowExpiresAt: new Date(),
  humanModeStartedAt: new Date(),
  humanModeExpiresAt: new Date(),
  processingLeaseOwner: null,
  processingLeaseExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function transactionPrisma() {
  const tx = {
    conversation: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(conversation),
      findMany: vi.fn().mockResolvedValue([]),
    },
    handoff: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx };
}

describe('human mode transitions', () => {
  it('manually enables AI atomically and resolves the active handoff', async () => {
    const { prisma, tx } = transactionPrisma();
    const notifier = { aiRestored: vi.fn().mockResolvedValue(undefined) };
    const service = new HandoffService(prisma as never, testConfig(), silentLogger, notifier);
    expect(await service.enableAiNow('conversation-1', admin)).toBe(true);
    expect(tx.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mode: ConversationMode.AI }) }),
    );
    expect(tx.handoff.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: HandoffStatus.RESOLVED }),
      }),
    );
    expect(notifier.aiRestored).toHaveBeenCalledWith('conversation-1', false);
  });

  it('extends human mode by 24 hours from button press time', async () => {
    const { prisma, tx } = transactionPrisma();
    const service = new HandoffService(prisma as never, testConfig(), silentLogger);
    const now = new Date('2026-08-03T00:00:00.000Z');
    const expiresAt = await service.extend('conversation-1', admin, now);
    expect(expiresAt.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    expect(tx.handoff.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expiresAt } }),
    );
  });

  it('automatically restores AI and expires the handoff without customer messaging', async () => {
    const { prisma, tx } = transactionPrisma();
    prisma.conversation.findMany.mockResolvedValue([{ id: 'conversation-1' }]);
    const notifier = { aiRestored: vi.fn().mockResolvedValue(undefined) };
    const service = new HandoffService(prisma as never, testConfig(), silentLogger, notifier);
    expect(await service.expireBatch(new Date())).toBe(1);
    expect(tx.handoff.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: HandoffStatus.EXPIRED }) }),
    );
    expect(notifier.aiRestored).toHaveBeenCalledWith('conversation-1', true);
  });
});
