import {
  IndexingAction,
  IndexingJobStatus,
  IndexingStatus,
  type KnowledgeItem,
  type PrismaClient,
} from '@prisma/client';
import { newId } from '../utils/ids.js';
import { ValidationError } from '../utils/errors.js';
import type { AppConfig } from '../config/env.js';
import type { KnowledgeInput } from '../domain/types.js';

export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  #validate(title: string, description: string): void {
    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();
    if (!normalizedTitle || normalizedTitle.length > this.config.rag.maxKnowledgeTitleLength) {
      throw new ValidationError('Knowledge title is empty or too long', 'INVALID_KNOWLEDGE_TITLE');
    }
    if (
      !normalizedDescription ||
      normalizedDescription.length > this.config.rag.maxKnowledgeDescriptionLength
    ) {
      throw new ValidationError(
        'Knowledge description is empty or too long',
        'INVALID_KNOWLEDGE_DESCRIPTION',
      );
    }
  }

  async create(input: KnowledgeInput, adminId: string): Promise<KnowledgeItem> {
    this.#validate(input.title, input.description);
    return this.prisma.$transaction(async (tx) => {
      const id = newId();
      const item = await tx.knowledgeItem.create({
        data: {
          id,
          businessAccountId: input.businessAccountId,
          title: input.title.trim(),
          description: input.description.trim(),
          isActive: input.isActive ?? true,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
          indexingStatus: IndexingStatus.PENDING,
        },
      });
      await tx.indexingJob.create({
        data: {
          id: newId(),
          knowledgeItemId: id,
          knowledgeVersion: item.version,
          action: item.isActive ? IndexingAction.UPSERT : IndexingAction.REMOVE,
          dedupeKey: `${id}:${item.version}:${item.isActive ? 'UPSERT' : 'REMOVE'}`,
          maxAttempts: this.config.worker.indexingMaxAttempts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId: input.businessAccountId,
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'KNOWLEDGE_CREATED',
          entityType: 'KnowledgeItem',
          entityId: id,
          metadata: { version: item.version },
        },
      });
      return item;
    });
  }

  async update(
    id: string,
    patch: { title?: string; description?: string },
    adminId: string,
  ): Promise<KnowledgeItem> {
    const current = await this.requireActiveRecord(id);
    const title = patch.title ?? current.title;
    const description = patch.description ?? current.description;
    this.#validate(title, description);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.knowledgeItem.update({
        where: { id },
        data: {
          title: title.trim(),
          description: description.trim(),
          version: { increment: 1 },
          updatedByAdminId: adminId,
          indexingStatus: IndexingStatus.PENDING,
          indexingError: null,
        },
      });
      await tx.indexingJob.create({
        data: {
          id: newId(),
          knowledgeItemId: id,
          knowledgeVersion: item.version,
          action: item.isActive ? IndexingAction.UPSERT : IndexingAction.REMOVE,
          dedupeKey: `${id}:${item.version}:${item.isActive ? 'UPSERT' : 'REMOVE'}`,
          maxAttempts: this.config.worker.indexingMaxAttempts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId: item.businessAccountId,
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'KNOWLEDGE_UPDATED',
          entityType: 'KnowledgeItem',
          entityId: id,
          metadata: { version: item.version },
        },
      });
      return item;
    });
  }

  async setActive(id: string, isActive: boolean, adminId: string): Promise<KnowledgeItem> {
    const current = await this.requireActiveRecord(id);
    if (current.isActive === isActive) return current;
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.knowledgeItem.update({
        where: { id },
        data: {
          isActive,
          version: { increment: 1 },
          updatedByAdminId: adminId,
          indexingStatus: IndexingStatus.PENDING,
          indexingError: null,
        },
      });
      const action = isActive ? IndexingAction.UPSERT : IndexingAction.REMOVE;
      await tx.indexingJob.create({
        data: {
          id: newId(),
          knowledgeItemId: id,
          knowledgeVersion: item.version,
          action,
          dedupeKey: `${id}:${item.version}:${action}`,
          maxAttempts: this.config.worker.indexingMaxAttempts,
        },
      });
      await tx.knowledgeChunk.updateMany({ where: { knowledgeItemId: id }, data: { isActive } });
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId: item.businessAccountId,
          actorType: 'ADMIN',
          actorId: adminId,
          action: isActive ? 'KNOWLEDGE_ENABLED' : 'KNOWLEDGE_DISABLED',
          entityType: 'KnowledgeItem',
          entityId: id,
        },
      });
      return item;
    });
  }

  async delete(id: string, adminId: string): Promise<void> {
    const current = await this.requireActiveRecord(id);
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.knowledgeItem.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          version: { increment: 1 },
          updatedByAdminId: adminId,
          indexingStatus: IndexingStatus.PENDING,
        },
      });
      await tx.knowledgeChunk.updateMany({
        where: { knowledgeItemId: id },
        data: { isActive: false },
      });
      await tx.indexingJob.create({
        data: {
          id: newId(),
          knowledgeItemId: id,
          knowledgeVersion: item.version,
          action: IndexingAction.REMOVE,
          dedupeKey: `${id}:${item.version}:REMOVE`,
          maxAttempts: this.config.worker.indexingMaxAttempts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId: current.businessAccountId,
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'KNOWLEDGE_DELETED',
          entityType: 'KnowledgeItem',
          entityId: id,
        },
      });
    });
  }

  async retryIndexing(id: string): Promise<void> {
    const item = await this.requireActiveRecord(id);
    const job = await this.prisma.indexingJob.findFirst({
      where: { knowledgeItemId: id, knowledgeVersion: item.version },
      orderBy: { createdAt: 'desc' },
    });
    if (!job) throw new ValidationError('No indexing job found', 'INDEXING_JOB_NOT_FOUND');
    await this.prisma.$transaction([
      this.prisma.indexingJob.update({
        where: { id: job.id },
        data: {
          status: IndexingJobStatus.PENDING,
          attempts: 0,
          availableAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
        },
      }),
      this.prisma.knowledgeItem.update({
        where: { id },
        data: { indexingStatus: IndexingStatus.PENDING, indexingError: null },
      }),
    ]);
  }

  async get(id: string): Promise<KnowledgeItem | null> {
    return this.prisma.knowledgeItem.findFirst({ where: { id, deletedAt: null } });
  }

  async list(businessAccountId: string, page = 1, pageSize = 10, query?: string) {
    const where = {
      businessAccountId,
      deletedAt: null,
      ...(query
        ? { OR: [{ title: { contains: query } }, { description: { contains: query } }] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.knowledgeItem.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.knowledgeItem.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  private async requireActiveRecord(id: string): Promise<KnowledgeItem> {
    const item = await this.get(id);
    if (!item) throw new ValidationError('Knowledge item not found', 'KNOWLEDGE_NOT_FOUND');
    return item;
  }
}
