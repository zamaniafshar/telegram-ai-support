import { ConversationMode, HandoffStatus, Prisma, } from '@prisma/client';
import { newId } from '../utils/ids.js';
import { hoursFrom } from '../utils/time.js';
import { AppError } from '../utils/errors.js';
export class HandoffService {
    prisma;
    config;
    logger;
    notifier;
    constructor(prisma, config, logger, notifier) {
        this.prisma = prisma;
        this.config = config;
        this.logger = logger;
        this.notifier = notifier;
    }
    async activate(conversationId, reasonCode, reasonDetail, now = new Date()) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const existing = await tx.handoff.findUnique({
                    where: { activeKey: `active:${conversationId}` },
                });
                if (existing) {
                    return {
                        conversation: await tx.conversation.findUniqueOrThrow({
                            where: { id: conversationId },
                        }),
                        handoff: existing,
                        created: false,
                    };
                }
                const expiresAt = hoursFrom(now, this.config.handoff.hours);
                const changed = await tx.conversation.updateMany({
                    where: {
                        id: conversationId,
                        mode: { in: [ConversationMode.AI, ConversationMode.PENDING_HUMAN] },
                    },
                    data: {
                        mode: ConversationMode.HUMAN,
                        humanModeStartedAt: now,
                        humanModeExpiresAt: expiresAt,
                    },
                });
                if (changed.count !== 1) {
                    throw new AppError('Conversation cannot enter human mode', 'HANDOFF_TRANSITION_REJECTED', 409);
                }
                const handoff = await tx.handoff.create({
                    data: {
                        id: newId(),
                        conversationId,
                        reasonCode,
                        reasonDetail: reasonDetail ?? null,
                        activeKey: `active:${conversationId}`,
                        startedAt: now,
                        expiresAt,
                    },
                });
                const conversation = await tx.conversation.findUniqueOrThrow({
                    where: { id: conversationId },
                });
                await tx.auditLog.create({
                    data: {
                        id: newId(),
                        businessAccountId: conversation.businessAccountId,
                        actorType: 'SYSTEM',
                        action: 'HUMAN_MODE_ACTIVATED',
                        entityType: 'Conversation',
                        entityId: conversationId,
                        metadata: { reasonCode, handoffId: handoff.id, expiresAt: expiresAt.toISOString() },
                    },
                });
                await this.notifier?.handoffActivatedInTransaction?.(tx, {
                    businessAccountId: conversation.businessAccountId,
                    conversationId,
                    handoffId: handoff.id,
                });
                return { conversation, handoff, created: true };
            });
        }
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const handoff = await this.prisma.handoff.findUniqueOrThrow({
                    where: { activeKey: `active:${conversationId}` },
                });
                return {
                    conversation: await this.prisma.conversation.findUniqueOrThrow({
                        where: { id: conversationId },
                    }),
                    handoff,
                    created: false,
                };
            }
            throw error;
        }
    }
    async enableAiNow(businessAccountId, conversationId, admin, now = new Date()) {
        const changed = await this.prisma.$transaction(async (tx) => {
            const update = await tx.conversation.updateMany({
                where: { id: conversationId, businessAccountId, mode: ConversationMode.HUMAN },
                data: { mode: ConversationMode.AI, humanModeStartedAt: null, humanModeExpiresAt: null },
            });
            if (update.count !== 1)
                return false;
            await tx.handoff.updateMany({
                where: { conversationId, activeKey: { not: null } },
                data: {
                    status: HandoffStatus.RESOLVED,
                    resolvedAt: now,
                    resolvedBy: admin.id,
                    activeKey: null,
                },
            });
            const conversation = await tx.conversation.findUniqueOrThrow({
                where: { id: conversationId },
            });
            await tx.auditLog.create({
                data: {
                    id: newId(),
                    businessAccountId: conversation.businessAccountId,
                    actorType: 'ADMIN',
                    actorId: admin.id,
                    action: 'AI_MODE_ENABLED_MANUALLY',
                    entityType: 'Conversation',
                    entityId: conversationId,
                },
            });
            await this.notifier?.aiRestoredInTransaction?.(tx, {
                businessAccountId,
                conversationId,
                automatic: false,
                eventKey: now.toISOString(),
            });
            return true;
        });
        if (changed && !this.notifier?.aiRestoredInTransaction) {
            await this.notifier?.aiRestored(conversationId, false);
        }
        return changed;
    }
    async extend(businessAccountId, conversationId, admin, now = new Date()) {
        const expiresAt = hoursFrom(now, this.config.handoff.hours);
        return this.prisma.$transaction(async (tx) => {
            const changed = await tx.conversation.updateMany({
                where: { id: conversationId, businessAccountId, mode: ConversationMode.HUMAN },
                data: { humanModeExpiresAt: expiresAt },
            });
            if (changed.count !== 1)
                throw new AppError('Conversation is not in human mode', 'NOT_HUMAN_MODE', 409);
            await tx.handoff.updateMany({
                where: { conversationId, activeKey: { not: null } },
                data: { expiresAt },
            });
            const conversation = await tx.conversation.findUniqueOrThrow({
                where: { id: conversationId },
            });
            await tx.auditLog.create({
                data: {
                    id: newId(),
                    businessAccountId: conversation.businessAccountId,
                    actorType: 'ADMIN',
                    actorId: admin.id,
                    action: 'HUMAN_MODE_EXTENDED',
                    entityType: 'Conversation',
                    entityId: conversationId,
                    metadata: { expiresAt: expiresAt.toISOString() },
                },
            });
            return expiresAt;
        });
    }
    async acknowledge(businessAccountId, conversationId, admin, now = new Date()) {
        await this.prisma.$transaction(async (tx) => {
            const changed = await tx.handoff.updateMany({
                where: {
                    conversationId,
                    status: HandoffStatus.WAITING,
                    activeKey: { not: null },
                    conversation: { businessAccountId },
                },
                data: {
                    status: HandoffStatus.ACKNOWLEDGED,
                    acknowledgedAt: now,
                    acknowledgedBy: admin.id,
                },
            });
            if (changed.count !== 1) {
                throw new AppError('Handoff is no longer waiting', 'HANDOFF_STATE_CONFLICT', 409);
            }
            await tx.auditLog.create({
                data: {
                    id: newId(),
                    businessAccountId,
                    actorType: 'ADMIN',
                    actorId: admin.id,
                    action: 'HANDOFF_ACKNOWLEDGED',
                    entityType: 'Conversation',
                    entityId: conversationId,
                },
            });
        });
    }
    async claim(businessAccountId, conversationId, admin, now = new Date()) {
        await this.prisma.$transaction(async (tx) => {
            const changed = await tx.handoff.updateMany({
                where: {
                    conversationId,
                    activeKey: { not: null },
                    claimedBy: null,
                    status: { in: [HandoffStatus.WAITING, HandoffStatus.ACKNOWLEDGED] },
                    conversation: { businessAccountId },
                },
                data: {
                    status: HandoffStatus.ACKNOWLEDGED,
                    acknowledgedAt: now,
                    acknowledgedBy: admin.id,
                    claimedAt: now,
                    claimedBy: admin.id,
                },
            });
            if (changed.count !== 1) {
                throw new AppError('Handoff is already claimed or closed', 'HANDOFF_CLAIM_CONFLICT', 409);
            }
            await tx.auditLog.create({
                data: {
                    id: newId(),
                    businessAccountId,
                    actorType: 'ADMIN',
                    actorId: admin.id,
                    action: 'HANDOFF_CLAIMED',
                    entityType: 'Conversation',
                    entityId: conversationId,
                },
            });
        });
    }
    async resolve(businessAccountId, conversationId, admin, outcome, note, now = new Date()) {
        await this.prisma.$transaction(async (tx) => {
            const conversation = await tx.conversation.updateMany({
                where: { id: conversationId, businessAccountId, mode: ConversationMode.HUMAN },
                data: { mode: ConversationMode.AI, humanModeStartedAt: null, humanModeExpiresAt: null },
            });
            if (conversation.count !== 1) {
                throw new AppError('Conversation is not in human mode', 'NOT_HUMAN_MODE', 409);
            }
            const handoff = await tx.handoff.updateMany({
                where: { conversationId, activeKey: { not: null }, conversation: { businessAccountId } },
                data: {
                    status: HandoffStatus.RESOLVED,
                    resolvedAt: now,
                    resolvedBy: admin.id,
                    resolutionOutcome: outcome,
                    resolutionNote: note?.trim() ?? null,
                    activeKey: null,
                },
            });
            if (handoff.count !== 1) {
                throw new AppError('Active handoff was not found', 'HANDOFF_STATE_CONFLICT', 409);
            }
            await tx.auditLog.create({
                data: {
                    id: newId(),
                    businessAccountId,
                    actorType: 'ADMIN',
                    actorId: admin.id,
                    action: 'HANDOFF_RESOLVED',
                    entityType: 'Conversation',
                    entityId: conversationId,
                    metadata: { outcome, hasNote: Boolean(note?.trim()), aiEnabled: true },
                },
            });
            await this.notifier?.aiRestoredInTransaction?.(tx, {
                businessAccountId,
                conversationId,
                automatic: false,
                eventKey: now.toISOString(),
            });
        });
        if (!this.notifier?.aiRestoredInTransaction)
            await this.notifier?.aiRestored(conversationId, false);
    }
    async expireBatch(now = new Date()) {
        const expired = await this.prisma.conversation.findMany({
            where: { mode: ConversationMode.HUMAN, humanModeExpiresAt: { lte: now } },
            select: { id: true },
            take: this.config.worker.batchSize,
        });
        let count = 0;
        for (const candidate of expired) {
            const changed = await this.prisma.$transaction(async (tx) => {
                const update = await tx.conversation.updateMany({
                    where: {
                        id: candidate.id,
                        mode: ConversationMode.HUMAN,
                        humanModeExpiresAt: { lte: now },
                    },
                    data: { mode: ConversationMode.AI, humanModeStartedAt: null, humanModeExpiresAt: null },
                });
                if (update.count !== 1)
                    return false;
                await tx.handoff.updateMany({
                    where: { conversationId: candidate.id, activeKey: { not: null } },
                    data: {
                        status: HandoffStatus.EXPIRED,
                        resolvedAt: now,
                        activeKey: null,
                    },
                });
                const conversation = await tx.conversation.findUniqueOrThrow({
                    where: { id: candidate.id },
                });
                await tx.auditLog.create({
                    data: {
                        id: newId(),
                        businessAccountId: conversation.businessAccountId,
                        actorType: 'SYSTEM',
                        action: 'AI_MODE_RESTORED_AUTOMATICALLY',
                        entityType: 'Conversation',
                        entityId: candidate.id,
                    },
                });
                await this.notifier?.aiRestoredInTransaction?.(tx, {
                    businessAccountId: conversation.businessAccountId,
                    conversationId: candidate.id,
                    automatic: true,
                    eventKey: now.toISOString(),
                });
                return true;
            });
            if (changed) {
                count += 1;
                this.logger.info({ conversationId: candidate.id }, 'AI mode restored automatically');
                if (!this.notifier?.aiRestoredInTransaction) {
                    await this.notifier
                        ?.aiRestored(candidate.id, true)
                        .catch((error) => this.logger.error({ err: error, conversationId: candidate.id }, 'AI restore notification failed'));
                }
            }
        }
        return count;
    }
}
//# sourceMappingURL=service.js.map