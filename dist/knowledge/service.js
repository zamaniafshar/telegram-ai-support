import { IndexingAction, IndexingJobStatus, IndexingStatus, } from '@prisma/client';
import { newId } from '../utils/ids.js';
import { ValidationError } from '../utils/errors.js';
export class KnowledgeService {
    prisma;
    config;
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    #validate(title, description) {
        const normalizedTitle = title.trim();
        const normalizedDescription = description.trim();
        if (!normalizedTitle || normalizedTitle.length > this.config.rag.maxKnowledgeTitleLength) {
            throw new ValidationError('Knowledge title is empty or too long', 'INVALID_KNOWLEDGE_TITLE');
        }
        if (!normalizedDescription ||
            normalizedDescription.length > this.config.rag.maxKnowledgeDescriptionLength) {
            throw new ValidationError('Knowledge description is empty or too long', 'INVALID_KNOWLEDGE_DESCRIPTION');
        }
    }
    async create(input, adminId) {
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
    async update(businessAccountId, id, patch, adminId) {
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
    async setActive(businessAccountId, id, isActive, adminId) {
        const current = await this.requireActiveRecord(businessAccountId, id);
        if (current.isActive === isActive)
            return current;
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
    async delete(businessAccountId, id, adminId) {
        return this.prisma.$transaction(async (tx) => {
            const changed = await tx.knowledgeItem.updateMany({
                where: { id, businessAccountId, deletedAt: null },
                data: {
                    deletedAt: new Date(),
                    isActive: false,
                    version: { increment: 1 },
                    updatedByAdminId: adminId,
                    indexingStatus: IndexingStatus.PENDING,
                    indexingError: null,
                },
            });
            const item = await tx.knowledgeItem.findFirst({ where: { id, businessAccountId } });
            if (!item)
                throw new ValidationError('Knowledge item not found', 'KNOWLEDGE_NOT_FOUND');
            await tx.knowledgeChunk.updateMany({
                where: { knowledgeItemId: id },
                data: { isActive: false },
            });
            const dedupeKey = `${id}:${item.version}:REMOVE`;
            const existingJob = await tx.indexingJob.findUnique({ where: { dedupeKey } });
            let cleanupJob = existingJob ??
                (await tx.indexingJob.create({
                    data: {
                        id: newId(),
                        knowledgeItemId: id,
                        knowledgeVersion: item.version,
                        action: IndexingAction.REMOVE,
                        dedupeKey,
                        maxAttempts: this.config.worker.indexingMaxAttempts,
                    },
                }));
            if (cleanupJob.status === IndexingJobStatus.FAILED) {
                cleanupJob = await tx.indexingJob.update({
                    where: { id: cleanupJob.id },
                    data: {
                        status: IndexingJobStatus.PENDING,
                        attempts: 0,
                        availableAt: new Date(),
                        leaseOwner: null,
                        leaseExpiresAt: null,
                        lastErrorCode: null,
                        lastErrorDetail: null,
                        completedAt: null,
                    },
                });
                await tx.knowledgeItem.updateMany({
                    where: { id, businessAccountId },
                    data: { indexingStatus: IndexingStatus.PENDING, indexingError: null },
                });
            }
            if (changed.count === 1) {
                await tx.auditLog.create({
                    data: {
                        id: newId(),
                        businessAccountId: item.businessAccountId,
                        actorType: 'ADMIN',
                        actorId: adminId,
                        action: 'KNOWLEDGE_DELETED',
                        entityType: 'KnowledgeItem',
                        entityId: id,
                        metadata: { cleanupJobId: cleanupJob.id },
                    },
                });
            }
            return {
                cleanupJobId: cleanupJob.id,
                cleanupStatus: cleanupJob.status,
                alreadyDeleted: changed.count === 0,
            };
        });
    }
    async retryIndexing(businessAccountId, id, adminId) {
        const item = await this.requireActiveRecord(businessAccountId, id);
        const job = await this.prisma.indexingJob.findFirst({
            where: { knowledgeItemId: id, knowledgeVersion: item.version },
            orderBy: { createdAt: 'desc' },
        });
        if (!job)
            throw new ValidationError('No indexing job found', 'INDEXING_JOB_NOT_FOUND');
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
    async get(businessAccountId, id) {
        return this.prisma.knowledgeItem.findFirst({
            where: { id, businessAccountId, deletedAt: null },
        });
    }
    async list(businessAccountId, page = 1, pageSize = 10, query) {
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
    async createDraft(businessAccountId, adminId, knowledgeItemId) {
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
    async updateDraft(businessAccountId, draftId, expectedRevision, patch, adminId) {
        if (patch.title !== undefined &&
            patch.title.trim().length > this.config.rag.maxKnowledgeTitleLength) {
            throw new ValidationError('Knowledge title is too long', 'INVALID_KNOWLEDGE_TITLE');
        }
        if (patch.description !== undefined &&
            patch.description.trim().length > this.config.rag.maxKnowledgeDescriptionLength) {
            throw new ValidationError('Knowledge description is too long', 'INVALID_KNOWLEDGE_DESCRIPTION');
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
            throw new ValidationError('Knowledge draft is stale or unavailable', 'DRAFT_VERSION_CONFLICT');
        }
        return this.prisma.knowledgeDraft.findFirstOrThrow({
            where: { id: draftId, businessAccountId },
        });
    }
    async getDraft(businessAccountId, draftId) {
        return this.prisma.knowledgeDraft.findFirst({ where: { id: draftId, businessAccountId } });
    }
    async listDrafts(businessAccountId) {
        return this.prisma.knowledgeDraft.findMany({
            where: { businessAccountId },
            orderBy: { updatedAt: 'desc' },
        });
    }
    async publishDraft(businessAccountId, draftId, expectedRevision, adminId) {
        const draft = await this.prisma.knowledgeDraft.findFirst({
            where: { id: draftId, businessAccountId, revision: expectedRevision },
        });
        if (!draft)
            throw new ValidationError('Knowledge draft is stale or unavailable', 'DRAFT_VERSION_CONFLICT');
        this.#validate(draft.title, draft.description);
        return this.prisma.$transaction(async (tx) => {
            let item;
            if (draft.knowledgeItemId) {
                const current = await tx.knowledgeItem.findFirst({
                    where: { id: draft.knowledgeItemId, businessAccountId, deletedAt: null },
                });
                if (!current)
                    throw new ValidationError('Knowledge item not found', 'KNOWLEDGE_NOT_FOUND');
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
            }
            else {
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
    async requireActiveRecord(businessAccountId, id) {
        const item = await this.get(businessAccountId, id);
        if (!item)
            throw new ValidationError('Knowledge item not found', 'KNOWLEDGE_NOT_FOUND');
        return item;
    }
}
//# sourceMappingURL=service.js.map