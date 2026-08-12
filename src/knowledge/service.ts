import {
  IndexingAction,
  IndexingJobStatus,
  IndexingStatus,
  type KnowledgeDraft,
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
    businessAccountId: string,
    id: string,
    patch: { title?: string; description?: string },
    adminId: string,
  ): Promise<KnowledgeItem> {
    const current = await this.requireActiveRecord(businessAccountId, id);
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

  async setActive(
    businessAccountId: string,
    id: string,
    isActive: boolean,
    adminId: string,
  ): Promise<KnowledgeItem> {
    const current = await this.requireActiveRecord(businessAccountId, id);
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

  async delete(businessAccountId: string, id: string, adminId: string): Promise<void> {
    const current = await this.requireActiveRecord(businessAccountId, id);
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

  async retryIndexing(businessAccountId: string, id: string, adminId: string): Promise<void> {
    const item = await this.requireActiveRecord(businessAccountId, id);
    const job = await this.prisma.indexingJob.findFirst({
      where: { knowledgeItemId: id, knowledgeVersion: item.version },
      orderBy: { createdAt: 'desc' },
    });
    if (!job) throw new ValidationError('No indexing job found', 'INDEXING_JOB_NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.indexingJob.update({
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
      });
      await tx.knowledgeItem.update({
        where: { id },
        data: { indexingStatus: IndexingStatus.PENDING, indexingError: null },
      });
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId,
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'KNOWLEDGE_INDEXING_RETRIED',
          entityType: 'KnowledgeItem',
          entityId: id,
          metadata: { version: item.version },
        },
      });
    });
  }

  async get(businessAccountId: string, id: string): Promise<KnowledgeItem | null> {
    return this.prisma.knowledgeItem.findFirst({
      where: { id, businessAccountId, deletedAt: null },
    });
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

  async createDraft(
    businessAccountId: string,
    adminId: string,
    knowledgeItemId?: string,
  ): Promise<KnowledgeDraft> {
    const source = knowledgeItemId
      ? await this.requireActiveRecord(businessAccountId, knowledgeItemId)
      : null;
    if (source) {
      return this.prisma.knowledgeDraft.upsert({
        where: { knowledgeItemId: source.id },
        create: {
          id: newId(),
          businessAccountId,
          knowledgeItemId: source.id,
          title: source.title,
          description: source.description,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
        },
        update: { updatedByAdminId: adminId },
      });
    }
    return this.prisma.knowledgeDraft.create({
      data: {
        id: newId(),
        businessAccountId,
        title: '',
        description: '',
        createdByAdminId: adminId,
        updatedByAdminId: adminId,
      },
    });
  }

  async updateDraft(
    businessAccountId: string,
    draftId: string,
    expectedRevision: number,
    patch: { title?: string; description?: string },
    adminId: string,
  ): Promise<KnowledgeDraft> {
    if (
      patch.title !== undefined &&
      patch.title.trim().length > this.config.rag.maxKnowledgeTitleLength
    ) {
      throw new ValidationError('Knowledge title is too long', 'INVALID_KNOWLEDGE_TITLE');
    }
    if (
      patch.description !== undefined &&
      patch.description.trim().length > this.config.rag.maxKnowledgeDescriptionLength
    ) {
      throw new ValidationError(
        'Knowledge description is too long',
        'INVALID_KNOWLEDGE_DESCRIPTION',
      );
    }
    const changed = await this.prisma.knowledgeDraft.updateMany({
      where: { id: draftId, businessAccountId, revision: expectedRevision },
      data: {
        ...(patch.title === undefined ? {} : { title: patch.title.trim() }),
        ...(patch.description === undefined ? {} : { description: patch.description.trim() }),
        updatedByAdminId: adminId,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throw new ValidationError(
        'Knowledge draft is stale or unavailable',
        'DRAFT_VERSION_CONFLICT',
      );
    }
    return this.prisma.knowledgeDraft.findFirstOrThrow({
      where: { id: draftId, businessAccountId },
    });
  }

  async getDraft(businessAccountId: string, draftId: string): Promise<KnowledgeDraft | null> {
    return this.prisma.knowledgeDraft.findFirst({ where: { id: draftId, businessAccountId } });
  }

  async listDrafts(businessAccountId: string): Promise<KnowledgeDraft[]> {
    return this.prisma.knowledgeDraft.findMany({
      where: { businessAccountId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async publishDraft(
    businessAccountId: string,
    draftId: string,
    expectedRevision: number,
    adminId: string,
  ): Promise<KnowledgeItem> {
    const draft = await this.prisma.knowledgeDraft.findFirst({
      where: { id: draftId, businessAccountId, revision: expectedRevision },
    });
    if (!draft)
      throw new ValidationError(
        'Knowledge draft is stale or unavailable',
        'DRAFT_VERSION_CONFLICT',
      );
    this.#validate(draft.title, draft.description);
    return this.prisma.$transaction(async (tx) => {
      let item: KnowledgeItem;
      if (draft.knowledgeItemId) {
        const current = await tx.knowledgeItem.findFirst({
          where: { id: draft.knowledgeItemId, businessAccountId, deletedAt: null },
        });
        if (!current) throw new ValidationError('Knowledge item not found', 'KNOWLEDGE_NOT_FOUND');
        item = await tx.knowledgeItem.update({
          where: { id: current.id },
          data: {
            title: draft.title.trim(),
            description: draft.description.trim(),
            version: { increment: 1 },
            updatedByAdminId: adminId,
            indexingStatus: IndexingStatus.PENDING,
            indexingError: null,
          },
        });
      } else {
        item = await tx.knowledgeItem.create({
          data: {
            id: newId(),
            businessAccountId,
            title: draft.title.trim(),
            description: draft.description.trim(),
            createdByAdminId: adminId,
            updatedByAdminId: adminId,
            indexingStatus: IndexingStatus.PENDING,
          },
        });
      }
      const action = item.isActive ? IndexingAction.UPSERT : IndexingAction.REMOVE;
      await tx.indexingJob.create({
        data: {
          id: newId(),
          knowledgeItemId: item.id,
          knowledgeVersion: item.version,
          action,
          dedupeKey: `${item.id}:${item.version}:${action}`,
          maxAttempts: this.config.worker.indexingMaxAttempts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId,
          actorType: 'ADMIN',
          actorId: adminId,
          action: draft.knowledgeItemId ? 'KNOWLEDGE_UPDATED' : 'KNOWLEDGE_CREATED',
          entityType: 'KnowledgeItem',
          entityId: item.id,
          metadata: { version: item.version, publishedFromDraftId: draft.id },
        },
      });
      await tx.knowledgeDraft.delete({ where: { id: draft.id } });
      return item;
    });
  }

  private async requireActiveRecord(businessAccountId: string, id: string): Promise<KnowledgeItem> {
    const item = await this.get(businessAccountId, id);
    if (!item) throw new ValidationError('Knowledge item not found', 'KNOWLEDGE_NOT_FOUND');
    return item;
  }
}
