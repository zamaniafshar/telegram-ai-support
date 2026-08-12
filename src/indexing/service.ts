import {
  IndexingAction,
  IndexingJobStatus,
  IndexingStatus,
  type IndexingJob,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { EmbeddingProvider } from '../ai/openai.js';
import type { VectorPoint, VectorStore } from '../retrieval/qdrant.js';
import { chunkKnowledge } from '../knowledge/chunker.js';
import { deterministicUuid } from '../utils/ids.js';
import { errorCode, isRetryable, safeErrorDetail } from '../utils/errors.js';
import { millisecondsFrom } from '../utils/time.js';
import { indexingFailureState } from './retry-policy.js';

export interface IndexingNotifier {
  indexingSucceeded(input: {
    businessAccountId: string;
    knowledgeId: string;
    title: string;
    chunkCount: number;
    knowledgeVersion?: number;
  }): Promise<void>;
  indexingFailed(input: {
    businessAccountId: string;
    knowledgeId: string;
    title: string;
    errorCode: string;
    knowledgeVersion?: number;
  }): Promise<void>;
  indexingSucceededInTransaction?(
    client: Prisma.TransactionClient,
    input: {
      businessAccountId: string;
      knowledgeId: string;
      title: string;
      chunkCount: number;
      knowledgeVersion?: number;
    },
  ): Promise<void>;
  indexingFailedInTransaction?(
    client: Prisma.TransactionClient,
    input: {
      businessAccountId: string;
      knowledgeId: string;
      title: string;
      errorCode: string;
      knowledgeVersion?: number;
    },
  ): Promise<void>;
}

export class IndexingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectors: VectorStore,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly notifier?: IndexingNotifier,
  ) {}

  async runBatch(workerId: string): Promise<number> {
    const candidates = await this.prisma.indexingJob.findMany({
      where: {
        status: {
          in: [IndexingJobStatus.PENDING, IndexingJobStatus.RETRY, IndexingJobStatus.PROCESSING],
        },
        availableAt: { lte: new Date() },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
      },
      orderBy: { availableAt: 'asc' },
      take: this.config.worker.batchSize,
      select: { id: true },
    });

    let processed = 0;
    for (const candidate of candidates) {
      const job = await this.#claim(candidate.id, workerId);
      if (!job) continue;
      if (!(await this.#acquireKnowledgeLease(job.knowledgeItemId, workerId))) {
        await this.prisma.indexingJob.update({
          where: { id: job.id },
          data: {
            status: IndexingJobStatus.RETRY,
            availableAt: millisecondsFrom(new Date(), 250),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        continue;
      }
      processed += 1;
      try {
        await this.#process(job);
      } catch (error) {
        await this.#fail(job, error);
      } finally {
        await this.#releaseKnowledgeLease(job.knowledgeItemId, workerId);
      }
    }
    return processed;
  }

  async #claim(id: string, workerId: string): Promise<IndexingJob | null> {
    const now = new Date();
    const claimed = await this.prisma.indexingJob.updateMany({
      where: {
        id,
        status: {
          in: [IndexingJobStatus.PENDING, IndexingJobStatus.RETRY, IndexingJobStatus.PROCESSING],
        },
        availableAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        status: IndexingJobStatus.PROCESSING,
        leaseOwner: workerId,
        leaseExpiresAt: millisecondsFrom(now, this.config.worker.leaseMs),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.indexingJob.findUniqueOrThrow({ where: { id } });
  }

  async #acquireKnowledgeLease(knowledgeItemId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.knowledgeItem.updateMany({
      where: {
        id: knowledgeItemId,
        OR: [
          { indexingLeaseExpiresAt: null },
          { indexingLeaseExpiresAt: { lt: now } },
          { indexingLeaseOwner: workerId },
        ],
      },
      data: {
        indexingLeaseOwner: workerId,
        indexingLeaseExpiresAt: millisecondsFrom(now, this.config.worker.leaseMs),
      },
    });
    return result.count === 1;
  }

  async #releaseKnowledgeLease(knowledgeItemId: string, workerId: string): Promise<void> {
    await this.prisma.knowledgeItem.updateMany({
      where: { id: knowledgeItemId, indexingLeaseOwner: workerId },
      data: { indexingLeaseOwner: null, indexingLeaseExpiresAt: null },
    });
  }

  async #process(job: IndexingJob): Promise<void> {
    const item = await this.prisma.knowledgeItem.findUniqueOrThrow({
      where: { id: job.knowledgeItemId },
    });
    if (item.version !== job.knowledgeVersion) {
      await this.#completeJob(job.id);
      return;
    }

    if (job.action === IndexingAction.REMOVE || !item.isActive || item.deletedAt) {
      await this.vectors.removeKnowledge(item.id);
      await this.prisma.$transaction([
        this.prisma.knowledgeChunk.updateMany({
          where: { knowledgeItemId: item.id },
          data: { isActive: false },
        }),
        this.prisma.knowledgeItem.updateMany({
          where: { id: item.id, version: item.version },
          data: { indexingStatus: IndexingStatus.READY, indexingError: null },
        }),
        this.prisma.indexingJob.update({
          where: { id: job.id },
          data: {
            status: IndexingJobStatus.COMPLETED,
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        }),
      ]);
      this.logger.info({ knowledgeId: item.id, action: job.action }, 'indexing job completed');
      return;
    }

    await this.prisma.knowledgeItem.updateMany({
      where: { id: item.id, version: item.version },
      data: { indexingStatus: IndexingStatus.INDEXING, indexingError: null },
    });
    const chunks = chunkKnowledge(
      item.description,
      this.config.rag.chunkMaxChars,
      this.config.rag.chunkOverlapChars,
    );
    const embeddings = await this.embeddings.embed(chunks.map((chunk) => chunk.content));
    if (embeddings.length !== chunks.length)
      throw new Error('Embedding count did not match chunks');

    const records = chunks.map((chunk) => ({
      id: deterministicUuid(`${item.id}:${item.version}:${chunk.index}`),
      qdrantChunkId: deterministicUuid(`qdrant:${item.id}:${item.version}:${chunk.index}`),
      chunk,
    }));
    const points: VectorPoint[] = records.map((record, index) => ({
      id: record.qdrantChunkId,
      vector: embeddings[index] ?? [],
      payload: {
        businessAccountId: item.businessAccountId,
        knowledgeId: item.id,
        chunkId: record.id,
        chunkIndex: record.chunk.index,
        knowledgeVersion: item.version,
        title: item.title,
        content: record.chunk.content,
        isActive: true,
        checksum: record.chunk.checksum,
      },
    }));
    await this.vectors.upsert(points);
    await this.vectors.removeObsoleteVersions(item.id, item.version);

    const published = await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({
        where: { knowledgeItemId: item.id, knowledgeVersion: { not: item.version } },
      });
      for (const record of records) {
        await tx.knowledgeChunk.upsert({
          where: { id: record.id },
          create: {
            id: record.id,
            knowledgeItemId: item.id,
            qdrantChunkId: record.qdrantChunkId,
            chunkIndex: record.chunk.index,
            knowledgeVersion: item.version,
            content: record.chunk.content,
            checksum: record.chunk.checksum,
          },
          update: {
            content: record.chunk.content,
            checksum: record.chunk.checksum,
            isActive: true,
          },
        });
      }
      const updated = await tx.knowledgeItem.updateMany({
        where: { id: item.id, version: item.version },
        data: { indexingStatus: IndexingStatus.READY, indexingError: null },
      });
      await tx.indexingJob.update({
        where: { id: job.id },
        data: {
          status: IndexingJobStatus.COMPLETED,
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
        },
      });
      if (updated.count === 1) {
        await this.notifier?.indexingSucceededInTransaction?.(tx, {
          businessAccountId: item.businessAccountId,
          knowledgeId: item.id,
          title: item.title,
          chunkCount: chunks.length,
          knowledgeVersion: item.version,
        });
      }
      return updated.count === 1;
    });
    this.logger.info(
      { indexingJobId: job.id, knowledgeId: item.id, chunks: chunks.length },
      'indexing job completed',
    );
    if (published && this.notifier && !this.notifier.indexingSucceededInTransaction) {
      await this.notifier
        .indexingSucceeded({
          businessAccountId: item.businessAccountId,
          knowledgeId: item.id,
          title: item.title,
          chunkCount: chunks.length,
        })
        .catch((notifyError: unknown) =>
          this.logger.error(
            { err: notifyError, knowledgeId: item.id },
            'indexing success notification failed',
          ),
        );
    }
  }

  async #completeJob(id: string): Promise<void> {
    await this.prisma.indexingJob.update({
      where: { id },
      data: {
        status: IndexingJobStatus.COMPLETED,
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  async #fail(job: IndexingJob, error: unknown): Promise<void> {
    const failure = indexingFailureState({
      retryable: isRetryable(error),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      baseDelayMs: this.config.worker.indexingBackoffBaseMs,
    });
    const retry = failure.retry;
    const code = errorCode(error);
    const detail = safeErrorDetail(error);
    await this.prisma.$transaction(async (tx) => {
      await tx.indexingJob.update({
        where: { id: job.id },
        data: {
          status: failure.jobStatus,
          availableAt: millisecondsFrom(new Date(), failure.backoffMs),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: code,
          lastErrorDetail: detail,
        },
      });
      await tx.knowledgeItem.updateMany({
        where: { id: job.knowledgeItemId, version: job.knowledgeVersion },
        data: {
          indexingStatus: failure.itemStatus,
          indexingError: detail,
        },
      });
      if (!retry && this.notifier?.indexingFailedInTransaction) {
        const item = await tx.knowledgeItem.findUniqueOrThrow({
          where: { id: job.knowledgeItemId },
        });
        await this.notifier.indexingFailedInTransaction(tx, {
          businessAccountId: item.businessAccountId,
          knowledgeId: item.id,
          title: item.title,
          errorCode: code,
          knowledgeVersion: item.version,
        });
      }
    });
    this.logger.error(
      { err: error, indexingJobId: job.id, retry, attempt: job.attempts },
      'indexing job failed',
    );
    if (!retry && this.notifier && !this.notifier.indexingFailedInTransaction) {
      const item = await this.prisma.knowledgeItem.findUniqueOrThrow({
        where: { id: job.knowledgeItemId },
      });
      await this.notifier
        .indexingFailed({
          businessAccountId: item.businessAccountId,
          knowledgeId: item.id,
          title: item.title,
          errorCode: code,
          knowledgeVersion: item.version,
        })
        .catch((notifyError: unknown) =>
          this.logger.error(
            { err: notifyError, knowledgeId: item.id },
            'indexing failure notification failed',
          ),
        );
    }
  }
}
