import { IndexingAction, IndexingJobStatus, IndexingStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { IndexingService } from '../src/indexing/service.js';
import { indexingFailureState } from '../src/indexing/retry-policy.js';
import { AppError } from '../src/utils/errors.js';
import { silentLogger, testConfig } from './helpers.js';

function indexingHarness(failUpsert = false) {
  const job = {
    id: 'job-1',
    knowledgeItemId: 'knowledge-1',
    knowledgeVersion: 2,
    action: IndexingAction.UPSERT,
    status: IndexingJobStatus.PROCESSING,
    dedupeKey: 'dedupe',
    attempts: 1,
    maxAttempts: 6,
    availableAt: new Date(),
    leaseOwner: 'worker',
    leaseExpiresAt: new Date(),
    lastErrorCode: null,
    lastErrorDetail: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const item = {
    id: 'knowledge-1',
    businessAccountId: 'business-1',
    title: 'Approved title',
    description: 'First approved paragraph.\n\nSecond approved paragraph.',
    isActive: true,
    version: 2,
    indexingStatus: IndexingStatus.PENDING,
    indexingError: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdByAdminId: 'admin',
    updatedByAdminId: 'admin',
  };
  const tx = {
    knowledgeChunk: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    knowledgeItem: {
      update: vi.fn().mockResolvedValue(item),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    indexingJob: { update: vi.fn().mockResolvedValue(job) },
  };
  const prisma = {
    indexingJob: {
      findMany: vi.fn().mockResolvedValue([{ id: job.id }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(job),
      update: tx.indexingJob.update,
    },
    knowledgeItem: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(item),
      update: tx.knowledgeItem.update,
      updateMany: tx.knowledgeItem.updateMany,
    },
    knowledgeChunk: tx.knowledgeChunk,
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === 'function') return input(tx);
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  const vectors = {
    upsert: failUpsert
      ? vi.fn().mockRejectedValue(new AppError('Qdrant timeout', 'QDRANT_TIMEOUT', 502, true))
      : vi.fn().mockResolvedValue(undefined),
    removeObsoleteVersions: vi.fn().mockResolvedValue(undefined),
    removeKnowledge: vi.fn().mockResolvedValue(undefined),
  };
  const embeddings = { embed: vi.fn().mockResolvedValue([[1, 0, 0]]) };
  return { prisma, vectors, embeddings, job };
}

describe('Qdrant indexing and replacement', () => {
  it('upserts current chunks then removes obsolete knowledge versions', async () => {
    const harness = indexingHarness();
    const service = new IndexingService(
      harness.prisma as never,
      harness.embeddings,
      harness.vectors as never,
      testConfig(),
      silentLogger,
    );
    expect(await service.runBatch('worker')).toBe(1);
    expect(harness.vectors.upsert).toHaveBeenCalledOnce();
    expect(harness.vectors.removeObsoleteVersions).toHaveBeenCalledWith('knowledge-1', 2);
    expect(harness.prisma.indexingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: IndexingJobStatus.COMPLETED }),
      }),
    );
  });

  it('records a retry instead of losing a MySQL indexing job on Qdrant failure', async () => {
    const harness = indexingHarness(true);
    const service = new IndexingService(
      harness.prisma as never,
      harness.embeddings,
      harness.vectors as never,
      testConfig(),
      silentLogger,
    );
    await service.runBatch('worker');
    expect(harness.prisma.indexingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: IndexingJobStatus.RETRY }),
      }),
    );
  });

  it('uses bounded exponential retry and a terminal failed state', () => {
    expect(
      indexingFailureState({ retryable: true, attempts: 2, maxAttempts: 6, baseDelayMs: 5_000 }),
    ).toMatchObject({ retry: true, backoffMs: 10_000, jobStatus: IndexingJobStatus.RETRY });
    expect(
      indexingFailureState({ retryable: true, attempts: 6, maxAttempts: 6, baseDelayMs: 5_000 }),
    ).toMatchObject({ retry: false, itemStatus: IndexingStatus.FAILED });
  });
});
