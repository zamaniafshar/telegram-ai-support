import { IndexingStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeService } from '../src/knowledge/service.js';
import { testConfig } from './helpers.js';

const baseItem = {
  id: 'knowledge-1',
  businessAccountId: 'business-1',
  title: 'Title',
  description: 'Approved description',
  isActive: true,
  version: 1,
  indexingStatus: IndexingStatus.PENDING,
  indexingError: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByAdminId: 'admin-1',
  updatedByAdminId: 'admin-1',
};

function knowledgePrisma() {
  const tx = {
    knowledgeItem: {
      create: vi.fn().mockResolvedValue(baseItem),
      update: vi.fn().mockResolvedValue({ ...baseItem, version: 2 }),
    },
    indexingJob: { create: vi.fn().mockResolvedValue({}), update: vi.fn() },
    knowledgeChunk: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    knowledgeItem: {
      ...tx.knowledgeItem,
      findFirst: vi.fn().mockResolvedValue(baseItem),
    },
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === 'function') return input(tx);
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  return { prisma, tx };
}

describe('knowledge CRUD durability', () => {
  it('stores knowledge and its indexing job in the same transaction', async () => {
    const { prisma, tx } = knowledgePrisma();
    const service = new KnowledgeService(prisma as never, testConfig());
    await service.create(
      { businessAccountId: 'business-1', title: ' Title ', description: ' Description ' },
      'admin-1',
    );
    expect(tx.knowledgeItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Title' }) }),
    );
    expect(tx.indexingJob.create).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('increments the version and queues replacement indexing on edit', async () => {
    const { prisma, tx } = knowledgePrisma();
    const service = new KnowledgeService(prisma as never, testConfig());
    await service.update(
      'business-1',
      'knowledge-1',
      { description: 'New approved facts' },
      'admin-1',
    );
    expect(tx.knowledgeItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: { increment: 1 } }) }),
    );
    expect(tx.indexingJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ knowledgeVersion: 2 }) }),
    );
  });

  it('soft-deletes knowledge and queues vector removal', async () => {
    const { prisma, tx } = knowledgePrisma();
    const service = new KnowledgeService(prisma as never, testConfig());
    await service.delete('business-1', 'knowledge-1', 'admin-1');
    expect(tx.knowledgeItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
    expect(tx.indexingJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REMOVE' }) }),
    );
  });

  it('validates knowledge length before touching MySQL', async () => {
    const { prisma } = knowledgePrisma();
    const service = new KnowledgeService(prisma as never, testConfig());
    await expect(
      service.create({ businessAccountId: 'business-1', title: '', description: 'facts' }, 'admin'),
    ).rejects.toMatchObject({ code: 'INVALID_KNOWLEDGE_TITLE' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
