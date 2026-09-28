import { AdminRole, HandoffStatus, IndexingStatus, NotificationSeverity, } from '@prisma/client';
import { chunkKnowledge } from '../knowledge/chunker.js';
import { AppError, AuthorizationError, ResourceUnavailableError, ValidationError, } from '../utils/errors.js';
import { newId } from '../utils/ids.js';
import { requireBusiness, requireOwner, requireRole } from './authorization.js';
import { defaultWeeklySchedule, validIanaTimezone, validateWeeklySchedule, } from '../ai/availability.js';
const adminSelect = {
    id: true,
    telegramUserId: true,
    displayName: true,
    role: true,
    isActive: true,
    updatedAt: true,
};
function customerName(customer) {
    return [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'بدون نام';
}
export class MiniAppManagementService {
    prisma;
    knowledge;
    handoffs;
    health;
    config;
    availability;
    notifier;
    systemLogger;
    constructor(prisma, knowledge, handoffs, health, config, availability, notifier, systemLogger) {
        this.prisma = prisma;
        this.knowledge = knowledge;
        this.handoffs = handoffs;
        this.health = health;
        this.config = config;
        this.availability = availability;
        this.notifier = notifier;
        this.systemLogger = systemLogger;
    }
    businesses(context) {
        return context.businessAccess
            .filter((access) => access.businessAccount.isActive)
            .map((access) => ({
            id: access.businessAccount.id,
            name: access.businessAccount.name,
            locale: access.businessAccount.defaultLocale,
        }));
    }
    async dashboard(context, businessAccountId) {
        const business = requireBusiness(context, businessAccountId);
        const [waitingHandoffs, humanConversations, failedKnowledge, conversationsToday, connection, recent,] = await Promise.all([
            this.prisma.handoff.count({
                where: {
                    activeKey: { not: null },
                    status: { in: [HandoffStatus.WAITING, HandoffStatus.ACKNOWLEDGED] },
                    conversation: { businessAccountId },
                },
            }),
            this.prisma.conversation.count({ where: { businessAccountId, mode: 'HUMAN' } }),
            context.admin.role === AdminRole.SUPPORT
                ? Promise.resolve(0)
                : this.prisma.knowledgeItem.count({
                    where: { businessAccountId, deletedAt: null, indexingStatus: IndexingStatus.FAILED },
                }),
            this.prisma.conversation.count({
                where: {
                    businessAccountId,
                    updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
                },
            }),
            this.prisma.businessConnection.findFirst({
                where: { businessAccountId },
                orderBy: { updatedAt: 'desc' },
                select: { enabled: true, canReply: true, updatedAt: true },
            }),
            this.prisma.handoff.findMany({
                where: { activeKey: { not: null }, conversation: { businessAccountId } },
                orderBy: { startedAt: 'asc' },
                take: 5,
                include: { conversation: { include: { customer: true } } },
            }),
        ]);
        return {
            business: {
                id: business.id,
                name: business.name,
                locale: business.defaultLocale,
            },
            metrics: { waitingHandoffs, humanConversations, failedKnowledge, conversationsToday },
            connection: connection
                ? {
                    status: connection.enabled && connection.canReply ? 'READY' : 'ATTENTION',
                    ...connection,
                }
                : { status: 'MISSING', enabled: false, canReply: false, updatedAt: null },
            recentHandoffs: recent.map((handoff) => ({
                id: handoff.id,
                conversationId: handoff.conversationId,
                status: handoff.status,
                customerName: customerName(handoff.conversation.customer),
                startedAt: handoff.startedAt,
                expiresAt: handoff.expiresAt,
                claimed: Boolean(handoff.claimedBy),
            })),
        };
    }
    async analyticsOverview(context, businessAccountId, options) {
        requireBusiness(context, businessAccountId);
        const where = this.#analyticsWhere(businessAccountId, options);
        const [total, sent, handoffs, failedOrSuppressed, aggregates] = await Promise.all([
            this.prisma.aiDecisionLog.count({ where }),
            this.prisma.aiDecisionLog.count({ where: { ...where, outcome: 'SENT' } }),
            this.prisma.aiDecisionLog.count({ where: { ...where, outcome: 'HANDOFF' } }),
            this.prisma.aiDecisionLog.count({
                where: { ...where, outcome: { in: ['FAILED', 'SUPPRESSED'] } },
            }),
            this.prisma.aiDecisionLog.aggregate({
                where,
                _avg: { totalLatencyMs: true, topRetrievalScore: true },
                _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
            }),
        ]);
        const inputTokens = aggregates._sum.inputTokens ?? 0;
        const outputTokens = aggregates._sum.outputTokens ?? 0;
        const inputPrice = this.config.analytics.inputCostPerMillionUsd;
        const outputPrice = this.config.analytics.outputCostPerMillionUsd;
        return {
            totalProcessed: total,
            answersSent: sent,
            handoffs,
            failedOrSuppressed,
            averageResponseTimeMs: aggregates._avg.totalLatencyMs ?? null,
            averageRetrievalScore: aggregates._avg.topRetrievalScore ?? null,
            tokens: { input: inputTokens, output: outputTokens, total: aggregates._sum.totalTokens ?? 0 },
            estimatedCostUsd: inputPrice !== undefined && outputPrice !== undefined
                ? (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000
                : null,
        };
    }
    async analyticsTraces(context, businessAccountId, options) {
        requireBusiness(context, businessAccountId);
        const where = this.#analyticsWhere(businessAccountId, options);
        const [total, traces] = await Promise.all([
            this.prisma.aiDecisionLog.count({ where }),
            this.prisma.aiDecisionLog.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: (options.page - 1) * options.pageSize,
                take: options.pageSize,
                select: {
                    id: true,
                    messageBatch: true,
                    decision: true,
                    answerable: true,
                    outcome: true,
                    confidence: true,
                    topRetrievalScore: true,
                    totalLatencyMs: true,
                    createdAt: true,
                },
            }),
        ]);
        return {
            items: traces.map((trace) => ({
                id: trace.id,
                customerMessagePreview: this.#messagePreview(trace.messageBatch),
                decision: trace.decision,
                answerable: trace.answerable,
                outcome: trace.outcome,
                confidence: trace.confidence,
                topRetrievalScore: trace.topRetrievalScore,
                latencyMs: trace.totalLatencyMs,
                createdAt: trace.createdAt,
            })),
            page: options.page,
            pageSize: options.pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / options.pageSize)),
        };
    }
    async analyticsTraceDetails(context, businessAccountId, traceId) {
        requireBusiness(context, businessAccountId);
        const trace = await this.prisma.aiDecisionLog.findFirst({
            where: { id: traceId, businessAccountId },
        });
        if (!trace)
            throw new ResourceUnavailableError();
        const raw = this.#jsonArray(trace.rawRetrievalResults);
        const validatedIds = new Set(this.#jsonArray(trace.validatedRetrievalResults).map((item) => this.#jsonString(item['chunkId'])));
        const sentIds = new Set(this.#jsonArray(trace.knowledgeSentToAi).map((item) => this.#jsonString(item['chunkId'])));
        const citedIds = new Set((Array.isArray(trace.supportingChunkIds) ? trace.supportingChunkIds : []).map((item) => this.#jsonString(item)));
        const canViewPromptInternals = context.admin.role !== AdminRole.SUPPORT;
        return {
            id: trace.id,
            createdAt: trace.createdAt,
            completedAt: trace.completedAt,
            customerMessages: this.#jsonArray(trace.messageBatch),
            conversationContext: canViewPromptInternals
                ? this.#jsonArray(trace.conversationContext)
                : null,
            retrieval: {
                raw,
                validated: this.#jsonArray(trace.validatedRetrievalResults),
                sentToAi: canViewPromptInternals ? this.#jsonArray(trace.knowledgeSentToAi) : null,
                citedChunkIds: [...citedIds],
                chunks: raw.map((item) => {
                    const chunkId = this.#jsonString(item['chunkId']);
                    return {
                        ...item,
                        validated: validatedIds.has(chunkId),
                        sentToAi: canViewPromptInternals ? sentIds.has(chunkId) : null,
                        citedByAi: citedIds.has(chunkId),
                    };
                }),
                latencyMs: trace.retrievalLatencyMs,
            },
            ai: {
                decision: trace.decision,
                answerable: trace.answerable,
                confidence: trace.confidence,
                reason: canViewPromptInternals ? trace.reason : null,
                answer: trace.answer,
                model: trace.model,
                promptVersion: canViewPromptInternals ? trace.promptVersion : null,
                tokens: {
                    input: trace.inputTokens,
                    output: trace.outputTokens,
                    total: trace.totalTokens,
                },
                latencyMs: trace.latencyMs,
            },
            outcome: {
                status: trace.outcome,
                reason: trace.outcomeReason,
                errorCode: trace.errorCode,
                totalLatencyMs: trace.totalLatencyMs,
            },
            permissions: { canViewPromptInternals },
        };
    }
    #analyticsWhere(businessAccountId, options) {
        const outcomes = ['PROCESSING', 'SENT', 'HANDOFF', 'SUPPRESSED', 'WAITING', 'FAILED'];
        const outcome = outcomes.find((value) => value === options.outcome);
        return {
            businessAccountId,
            ...(outcome ? { outcome } : {}),
            ...(options.from || options.to
                ? {
                    createdAt: {
                        ...(options.from ? { gte: options.from } : {}),
                        ...(options.to ? { lte: options.to } : {}),
                    },
                }
                : {}),
        };
    }
    #jsonArray(value) {
        if (!Array.isArray(value))
            return [];
        return value.filter((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    }
    #messagePreview(value) {
        return this.#jsonArray(value)
            .map((item) => (typeof item['text'] === 'string' ? item['text'] : ''))
            .filter(Boolean)
            .join(' • ')
            .slice(0, 180);
    }
    #jsonString(value) {
        return typeof value === 'string' ? value : '';
    }
    async listHandoffs(context, businessAccountId, options) {
        requireBusiness(context, businessAccountId);
        const requestedStatus = options.status
            ? Object.values(HandoffStatus).find((value) => value === options.status)
            : undefined;
        const conversations = await this.prisma.conversation.findMany({
            where: {
                businessAccountId,
                ...(options.query
                    ? {
                        OR: [
                            {
                                customer: {
                                    OR: [
                                        { firstName: { contains: options.query } },
                                        { lastName: { contains: options.query } },
                                        { username: { contains: options.query } },
                                    ],
                                },
                            },
                            { messages: { some: { deletedAt: null, text: { contains: options.query } } } },
                        ],
                    }
                    : {}),
            },
            orderBy: { updatedAt: 'desc' },
            take: 200,
            include: {
                customer: true,
                handoffs: { orderBy: { startedAt: 'desc' }, take: 1 },
                messages: {
                    where: { deletedAt: null },
                    orderBy: { sentAt: 'desc' },
                    take: 1,
                    select: { id: true, text: true, senderType: true, sentAt: true },
                },
            },
        });
        return conversations
            .map((conversation) => {
            const handoff = conversation.handoffs[0] ?? null;
            return {
                id: handoff?.id ?? conversation.id,
                conversationId: conversation.id,
                status: handoff?.status ?? 'NONE',
                reasonCode: handoff?.reasonCode ?? 'NO_HANDOFF',
                startedAt: handoff?.startedAt ?? conversation.updatedAt,
                expiresAt: handoff?.expiresAt ?? conversation.telegramReplyWindowExpiresAt,
                claimedBy: handoff?.claimedBy ?? null,
                customer: {
                    name: customerName(conversation.customer),
                    username: conversation.customer.username,
                    telegramUserId: conversation.customer.telegramUserId.toString(),
                },
                mode: conversation.mode,
                updatedAt: conversation.updatedAt,
                lastMessage: conversation.messages[0] ?? null,
            };
        })
            .filter((item) => !requestedStatus || item.status === requestedStatus)
            .sort((left, right) => {
            const leftWaiting = left.status === HandoffStatus.WAITING ? 1 : 0;
            const rightWaiting = right.status === HandoffStatus.WAITING ? 1 : 0;
            if (leftWaiting !== rightWaiting)
                return rightWaiting - leftWaiting;
            return right.updatedAt.getTime() - left.updatedAt.getTime();
        })
            .slice(0, 100);
    }
    async handoffDetails(context, businessAccountId, conversationId) {
        requireBusiness(context, businessAccountId);
        const conversation = await this.prisma.conversation.findFirst({
            where: { id: conversationId, businessAccountId },
            include: {
                customer: true,
                handoffs: { orderBy: { startedAt: 'desc' }, take: 10 },
                messages: {
                    where: { deletedAt: null },
                    orderBy: { sentAt: 'desc' },
                    take: 30,
                    select: { id: true, senderType: true, text: true, sentAt: true, editedAt: true },
                },
            },
        });
        if (!conversation)
            throw new ResourceUnavailableError();
        const active = conversation.handoffs.find((handoff) => handoff.activeKey !== null) ?? null;
        return {
            id: conversation.id,
            mode: conversation.mode,
            humanModeExpiresAt: conversation.humanModeExpiresAt,
            replyWindowExpiresAt: conversation.telegramReplyWindowExpiresAt,
            customer: {
                name: customerName(conversation.customer),
                username: conversation.customer.username,
                telegramUserId: conversation.customer.telegramUserId.toString(),
                languageCode: conversation.customer.languageCode,
            },
            activeHandoff: active,
            history: conversation.handoffs,
            messages: conversation.messages,
            capabilities: {
                canClaim: Boolean(active && !active.claimedBy),
                canAcknowledge: active?.status === HandoffStatus.WAITING,
                canExtend: Boolean(active && conversation.mode === 'HUMAN'),
                canResolve: Boolean(active && conversation.mode === 'HUMAN'),
                canEnableAi: conversation.mode === 'HUMAN',
            },
        };
    }
    async listConversations(context, businessAccountId, options) {
        requireBusiness(context, businessAccountId);
        const modes = ['AI', 'PENDING_HUMAN', 'HUMAN'];
        const mode = modes.find((value) => value === options.mode);
        const conversations = await this.prisma.conversation.findMany({
            where: {
                businessAccountId,
                ...(mode ? { mode } : {}),
                ...(options.query
                    ? {
                        OR: [
                            {
                                customer: {
                                    OR: [
                                        { firstName: { contains: options.query } },
                                        { lastName: { contains: options.query } },
                                        { username: { contains: options.query } },
                                    ],
                                },
                            },
                            { messages: { some: { deletedAt: null, text: { contains: options.query } } } },
                        ],
                    }
                    : {}),
            },
            orderBy: { updatedAt: 'desc' },
            take: 100,
            include: {
                customer: true,
                messages: {
                    where: { deletedAt: null },
                    orderBy: { sentAt: 'desc' },
                    take: 1,
                    select: { text: true, sentAt: true, senderType: true, processingStatus: true },
                },
                handoffs: { where: { activeKey: { not: null } }, take: 1 },
            },
        });
        return conversations.map((conversation) => ({
            id: conversation.id,
            customer: {
                name: customerName(conversation.customer),
                username: conversation.customer.username,
            },
            mode: conversation.mode,
            updatedAt: conversation.updatedAt,
            replyWindowExpiresAt: conversation.telegramReplyWindowExpiresAt,
            lastMessage: conversation.messages[0] ?? null,
            hasActiveHandoff: conversation.handoffs.length > 0,
        }));
    }
    async conversationDetails(context, businessAccountId, conversationId) {
        requireBusiness(context, businessAccountId);
        const conversation = await this.prisma.conversation.findFirst({
            where: { id: conversationId, businessAccountId },
            include: {
                customer: true,
                messages: {
                    where: { deletedAt: null },
                    orderBy: { sentAt: 'desc' },
                    take: 100,
                    select: {
                        id: true,
                        senderType: true,
                        direction: true,
                        text: true,
                        sentAt: true,
                        editedAt: true,
                        processingStatus: true,
                        processingErrorCode: true,
                    },
                },
                handoffs: { orderBy: { startedAt: 'desc' }, take: 20 },
                aiDecisions: { orderBy: { createdAt: 'desc' }, take: 30 },
            },
        });
        if (!conversation)
            throw new ResourceUnavailableError();
        const showDiagnostics = context.admin.role !== AdminRole.SUPPORT;
        return {
            id: conversation.id,
            mode: conversation.mode,
            updatedAt: conversation.updatedAt,
            humanModeExpiresAt: conversation.humanModeExpiresAt,
            replyWindowExpiresAt: conversation.telegramReplyWindowExpiresAt,
            customer: {
                name: customerName(conversation.customer),
                username: conversation.customer.username,
                telegramUserId: conversation.customer.telegramUserId.toString(),
            },
            messages: conversation.messages.map((message) => ({
                ...message,
                processingErrorCode: showDiagnostics ? message.processingErrorCode : undefined,
            })),
            handoffs: conversation.handoffs,
            aiDecisions: conversation.aiDecisions.map((decision) => ({
                id: decision.id,
                answerable: decision.answerable,
                confidence: decision.confidence,
                createdAt: decision.createdAt,
                latencyMs: decision.latencyMs,
                ...(showDiagnostics
                    ? {
                        reason: decision.reason,
                        model: decision.model,
                        promptVersion: decision.promptVersion,
                        totalTokens: decision.totalTokens,
                        errorCode: decision.errorCode,
                        supportingChunkIds: decision.supportingChunkIds,
                    }
                    : {}),
            })),
        };
    }
    async listKnowledge(context, businessAccountId, options) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        const [published, drafts] = await Promise.all([
            this.knowledge.list(businessAccountId, 1, 100, options.query),
            this.knowledge.listDrafts(businessAccountId),
        ]);
        return {
            published: published.items,
            drafts: drafts.filter((draft) => !options.query ||
                draft.title.includes(options.query) ||
                draft.description.includes(options.query)),
        };
    }
    async knowledgeDetails(context, businessAccountId, knowledgeId) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        const item = await this.knowledge.get(businessAccountId, knowledgeId);
        if (!item)
            throw new ResourceUnavailableError();
        const [chunks, jobs, draft] = await Promise.all([
            this.prisma.knowledgeChunk.findMany({
                where: { knowledgeItemId: item.id, knowledgeItem: { businessAccountId } },
                orderBy: { chunkIndex: 'asc' },
                select: {
                    id: true,
                    chunkIndex: true,
                    knowledgeVersion: true,
                    content: true,
                    isActive: true,
                },
            }),
            this.prisma.indexingJob.findMany({
                where: { knowledgeItemId: item.id, knowledgeItem: { businessAccountId } },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: {
                    id: true,
                    status: true,
                    attempts: true,
                    maxAttempts: true,
                    lastErrorCode: true,
                    createdAt: true,
                    completedAt: true,
                },
            }),
            this.prisma.knowledgeDraft.findFirst({
                where: { knowledgeItemId: item.id, businessAccountId },
            }),
        ]);
        return { item, chunks, jobs, draft };
    }
    async createKnowledgeDraft(context, businessAccountId, knowledgeItemId) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        return this.knowledge.createDraft(businessAccountId, context.admin.id, knowledgeItemId);
    }
    async updateKnowledgeDraft(context, businessAccountId, draftId, input) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        return this.knowledge.updateDraft(businessAccountId, draftId, input.revision, {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.description === undefined ? {} : { description: input.description }),
        }, context.admin.id);
    }
    async knowledgeDraftDetails(context, businessAccountId, draftId) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        const draft = await this.knowledge.getDraft(businessAccountId, draftId);
        if (!draft)
            throw new ResourceUnavailableError();
        return draft;
    }
    async previewKnowledgeDraft(context, businessAccountId, draftId) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        const draft = await this.knowledge.getDraft(businessAccountId, draftId);
        if (!draft)
            throw new ResourceUnavailableError();
        if (!draft.description.trim())
            return [];
        return chunkKnowledge(draft.description, this.config.rag.chunkMaxChars, this.config.rag.chunkOverlapChars);
    }
    async publishKnowledgeDraft(context, businessAccountId, draftId, revision) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        return this.knowledge.publishDraft(businessAccountId, draftId, revision, context.admin.id);
    }
    async listConnections(context, businessAccountId) {
        requireBusiness(context, businessAccountId);
        const showDiagnostics = context.admin.role !== AdminRole.SUPPORT;
        const connections = await this.prisma.businessConnection.findMany({
            where: { businessAccountId },
            orderBy: { updatedAt: 'desc' },
        });
        return connections.map((connection) => ({
            id: showDiagnostics ? connection.id : undefined,
            enabled: connection.enabled,
            canReply: connection.canReply,
            connectedAt: connection.connectedAt,
            disabledAt: connection.disabledAt,
            updatedAt: connection.updatedAt,
            rights: showDiagnostics ? connection.rights : undefined,
        }));
    }
    async systemHealth(context, businessAccountId) {
        requireBusiness(context, businessAccountId);
        const [report, indexing, conversationJobs, notificationDeliveries, credit, aiAvailability, aiSuppressions, settingsChanges,] = await Promise.all([
            this.health.readiness(),
            this.prisma.indexingJob.groupBy({
                by: ['status'],
                where: { knowledgeItem: { businessAccountId } },
                _count: true,
            }),
            this.prisma.conversationJob.groupBy({
                by: ['status'],
                where: { conversation: { businessAccountId } },
                _count: true,
            }),
            this.prisma.notificationDelivery.groupBy({
                by: ['status'],
                where: { notification: { businessAccountId } },
                _count: true,
            }),
            this.prisma.providerCreditMonitorState.findUnique({ where: { id: 'nanogpt' } }),
            this.availability ? this.availability.check({ businessAccountId }) : Promise.resolve(null),
            this.prisma.auditLog.groupBy({
                by: ['action'],
                where: {
                    businessAccountId,
                    action: {
                        in: [
                            'AI_RESPONSE_SUPPRESSED_MASTER_DISABLED',
                            'AI_RESPONSE_SUPPRESSED_OUTSIDE_WORKING_HOURS',
                        ],
                    },
                },
                _count: true,
            }),
            this.prisma.auditLog.count({
                where: {
                    businessAccountId,
                    action: {
                        in: [
                            'AI_MASTER_ENABLED',
                            'AI_MASTER_DISABLED',
                            'AI_WORKING_HOURS_UPDATED',
                            'AI_TIMEZONE_UPDATED',
                        ],
                    },
                },
            }),
        ]);
        const showDiagnostics = context.admin.role !== AdminRole.SUPPORT;
        return {
            ready: report.ready,
            checks: showDiagnostics ? report.checks : undefined,
            queues: showDiagnostics
                ? { indexing, conversations: conversationJobs, notifications: notificationDeliveries }
                : undefined,
            credit: showDiagnostics && credit
                ? {
                    lastCheckedAt: credit.lastCheckedAt,
                    isLow: credit.lastBalanceUsd !== null &&
                        credit.lastBalanceUsd.toNumber() < this.config.nanoGptCredit.lowBalanceUsd,
                }
                : undefined,
            ai: {
                availability: aiAvailability,
                suppressions: Object.fromEntries(aiSuppressions.map((item) => [item.action, item._count])),
                settingsChanges,
            },
        };
    }
    async listAdmins(context, businessAccountId) {
        requireOwner(context);
        requireBusiness(context, businessAccountId);
        const accesses = await this.prisma.adminBusinessAccount.findMany({
            where: { businessAccountId },
            orderBy: { createdAt: 'asc' },
            include: { admin: { select: adminSelect } },
        });
        return accesses.map((access) => ({
            ...access.admin,
            telegramUserId: access.admin.telegramUserId.toString(),
            protected: access.admin.role === AdminRole.OWNER || access.admin.id === context.admin.id,
        }));
    }
    async addAdmin(context, businessAccountId, input) {
        requireOwner(context);
        requireBusiness(context, businessAccountId);
        if (!/^\d{1,20}$/.test(input.telegramUserId)) {
            throw new ValidationError('Telegram ID is invalid', 'INVALID_TELEGRAM_ID');
        }
        if (input.role !== AdminRole.ADMIN && input.role !== AdminRole.SUPPORT) {
            throw new ValidationError('Role is invalid', 'INVALID_ROLE');
        }
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.admin.findUnique({
                where: { telegramUserId: BigInt(input.telegramUserId) },
            });
            if (existing?.role === AdminRole.OWNER)
                throw new AuthorizationError();
            const admin = await tx.admin.upsert({
                where: { telegramUserId: BigInt(input.telegramUserId) },
                create: {
                    id: newId(),
                    telegramUserId: BigInt(input.telegramUserId),
                    role: input.role,
                    displayName: input.displayName?.trim() ?? null,
                },
                update: {
                    role: input.role,
                    isActive: true,
                    ...(input.displayName === undefined
                        ? {}
                        : { displayName: input.displayName.trim() || null }),
                },
            });
            await tx.adminBusinessAccount.upsert({
                where: { adminId_businessAccountId: { adminId: admin.id, businessAccountId } },
                create: { adminId: admin.id, businessAccountId },
                update: {},
            });
            await tx.auditLog.create({
                data: {
                    id: newId(),
                    businessAccountId,
                    actorType: 'ADMIN',
                    actorId: context.admin.id,
                    action: 'ADMIN_AUTHORIZED',
                    entityType: 'Admin',
                    entityId: admin.id,
                    metadata: { role: input.role },
                },
            });
            return { ...admin, telegramUserId: admin.telegramUserId.toString() };
        });
    }
    async updateAdmin(context, businessAccountId, targetId, input) {
        requireOwner(context);
        requireBusiness(context, businessAccountId);
        if (targetId === context.admin.id)
            throw new AuthorizationError();
        const target = await this.prisma.admin.findFirst({
            where: { id: targetId, businessAccess: { some: { businessAccountId } } },
        });
        if (!target || target.role === AdminRole.OWNER)
            throw new ResourceUnavailableError();
        if (input.role && input.role !== AdminRole.ADMIN && input.role !== AdminRole.SUPPORT) {
            throw new ValidationError('Role is invalid', 'INVALID_ROLE');
        }
        return this.prisma.$transaction(async (tx) => {
            const admin = await tx.admin.update({
                where: { id: target.id },
                data: {
                    ...(input.role ? { role: input.role } : {}),
                    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
                },
            });
            await tx.auditLog.create({
                data: {
                    id: newId(),
                    businessAccountId,
                    actorType: 'ADMIN',
                    actorId: context.admin.id,
                    action: input.role && input.role !== target.role
                        ? 'ADMIN_ROLE_CHANGED'
                        : input.isActive
                            ? 'ADMIN_ACTIVATED'
                            : 'ADMIN_DEACTIVATED',
                    entityType: 'Admin',
                    entityId: target.id,
                    metadata: { previousRole: target.role, role: admin.role, isActive: admin.isActive },
                },
            });
            if (!admin.isActive) {
                await tx.adminSession.updateMany({
                    where: { adminId: admin.id, revokedAt: null },
                    data: { revokedAt: new Date() },
                });
            }
            return { ...admin, telegramUserId: admin.telegramUserId.toString() };
        });
    }
    async removeAdminAccess(context, businessAccountId, targetId) {
        requireOwner(context);
        requireBusiness(context, businessAccountId);
        if (targetId === context.admin.id)
            throw new AuthorizationError();
        const target = await this.prisma.admin.findFirst({
            where: {
                id: targetId,
                role: { not: AdminRole.OWNER },
                businessAccess: { some: { businessAccountId } },
            },
        });
        if (!target)
            throw new ResourceUnavailableError();
        await this.prisma.$transaction(async (tx) => {
            await tx.adminBusinessAccount.delete({
                where: { adminId_businessAccountId: { adminId: target.id, businessAccountId } },
            });
            const remaining = await tx.adminBusinessAccount.count({ where: { adminId: target.id } });
            if (remaining === 0) {
                await tx.admin.update({ where: { id: target.id }, data: { isActive: false } });
                await tx.adminSession.updateMany({
                    where: { adminId: target.id, revokedAt: null },
                    data: { revokedAt: new Date() },
                });
            }
            await tx.auditLog.create({
                data: {
                    id: newId(),
                    businessAccountId,
                    actorType: 'ADMIN',
                    actorId: context.admin.id,
                    action: 'ADMIN_ACCESS_REMOVED',
                    entityType: 'Admin',
                    entityId: target.id,
                    metadata: { remainingBusinessAssignments: remaining },
                },
            });
        });
    }
    async audit(context, businessAccountId, options) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        return this.prisma.auditLog.findMany({
            where: { businessAccountId, ...(options.action ? { action: options.action } : {}) },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
    }
    settings(context, businessAccountId) {
        requireBusiness(context, businessAccountId);
        return {
            timezone: 'Asia/Tehran',
            locale: 'fa',
            humanModeHours: this.config.handoff.hours,
            notifyAdditionalMessages: this.config.handoff.notifyAdditionalMessages,
            customerAcknowledgementEnabled: this.config.handoff.customerMessageEnabled,
            managedByDeployment: true,
        };
    }
    async aiSettings(context, businessAccountId) {
        const business = requireBusiness(context, businessAccountId);
        const settings = await this.prisma.businessAiSettings.findUnique({
            where: { businessAccountId },
            include: { updatedByAdmin: { select: { id: true, displayName: true } } },
        });
        const availability = this.availability
            ? await this.availability.check({ businessAccountId })
            : null;
        return {
            business: { id: business.id, name: business.name },
            enabled: settings?.enabled ?? true,
            timezone: settings?.timezone ?? this.config.business.defaultTimezone,
            weeklySchedule: settings?.weeklySchedule ??
                defaultWeeklySchedule(),
            outsideHoursPolicy: settings?.outsideHoursPolicy ?? 'QUEUE',
            manualShutdownPolicy: settings?.manualShutdownPolicy ?? 'QUEUE',
            backlogMaxAgeHours: settings?.backlogMaxAgeHours ?? 24,
            version: settings?.version ?? 0,
            updatedAt: settings?.updatedAt ?? null,
            updatedBy: settings?.updatedByAdmin ?? null,
            lastChangeReason: settings?.lastChangeReason ?? null,
            canEdit: context.admin.role !== AdminRole.SUPPORT,
            availability,
        };
    }
    async aiAvailability(context, businessAccountId) {
        requireBusiness(context, businessAccountId);
        if (!this.availability)
            throw new AppError('Availability service missing', 'INTERNAL_ERROR');
        return this.availability.check({ businessAccountId });
    }
    async updateAiSettings(context, businessAccountId, input, correlationId) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        if (!validIanaTimezone(input.timezone)) {
            throw new ValidationError('Timezone is invalid', 'INVALID_TIMEZONE');
        }
        const schedule = validateWeeklySchedule(input.weeklySchedule);
        const trimmedReason = input.reason?.trim();
        const reason = trimmedReason === '' ? null : (trimmedReason ?? null);
        if (reason && reason.length > 500) {
            throw new ValidationError('Reason is too long', 'INVALID_CHANGE_REASON');
        }
        await this.prisma.$transaction(async (tx) => {
            const previous = await tx.businessAiSettings.findUnique({ where: { businessAccountId } });
            let saved;
            if (!previous) {
                if (input.version !== 0)
                    throw new AppError('Settings changed', 'STATE_CONFLICT', 409);
                saved = await tx.businessAiSettings.create({
                    data: {
                        id: newId(),
                        businessAccountId,
                        enabled: input.enabled,
                        timezone: input.timezone,
                        weeklySchedule: schedule,
                        outsideHoursPolicy: input.outsideHoursPolicy,
                        manualShutdownPolicy: input.manualShutdownPolicy,
                        backlogMaxAgeHours: input.backlogMaxAgeHours,
                        version: 1,
                        lastChangeReason: reason,
                        updatedByAdminId: context.admin.id,
                    },
                });
            }
            else {
                const changed = await tx.businessAiSettings.updateMany({
                    where: { businessAccountId, version: input.version },
                    data: {
                        enabled: input.enabled,
                        timezone: input.timezone,
                        weeklySchedule: schedule,
                        outsideHoursPolicy: input.outsideHoursPolicy,
                        manualShutdownPolicy: input.manualShutdownPolicy,
                        backlogMaxAgeHours: input.backlogMaxAgeHours,
                        version: { increment: 1 },
                        lastChangeReason: reason,
                        updatedByAdminId: context.admin.id,
                    },
                });
                if (changed.count !== 1)
                    throw new AppError('Settings changed', 'STATE_CONFLICT', 409);
                saved = await tx.businessAiSettings.findUniqueOrThrow({ where: { businessAccountId } });
            }
            const previousEnabled = previous?.enabled ?? true;
            const previousTimezone = previous?.timezone ?? this.config.business.defaultTimezone;
            const previousSchedule = previous?.weeklySchedule ??
                defaultWeeklySchedule();
            const events = [];
            if (previousEnabled !== saved.enabled) {
                events.push(saved.enabled ? 'AI_MASTER_ENABLED' : 'AI_MASTER_DISABLED');
            }
            if (previousTimezone !== saved.timezone)
                events.push('AI_TIMEZONE_UPDATED');
            if (JSON.stringify(previousSchedule) !== JSON.stringify(schedule)) {
                events.push('AI_WORKING_HOURS_UPDATED');
            }
            if (events.length === 0)
                events.push('AI_SETTINGS_UPDATED');
            for (const action of events) {
                await tx.auditLog.create({
                    data: {
                        id: newId(),
                        businessAccountId,
                        actorType: 'ADMIN',
                        actorId: context.admin.id,
                        action,
                        entityType: 'BusinessAiSettings',
                        entityId: saved.id,
                        correlationId: correlationId ?? null,
                        metadata: {
                            previous: {
                                enabled: previousEnabled,
                                timezone: previousTimezone,
                                weeklySchedule: previousSchedule,
                            },
                            next: { enabled: saved.enabled, timezone: saved.timezone, weeklySchedule: schedule },
                            reason,
                        },
                    },
                });
            }
            if (previousEnabled !== saved.enabled && this.notifier) {
                await this.notifier.enqueue(tx, {
                    dedupeKey: `${saved.enabled ? 'AI_MASTER_ENABLED' : 'AI_MASTER_DISABLED'}:${saved.id}:${saved.version}`,
                    type: saved.enabled ? 'AI_MASTER_ENABLED' : 'AI_MASTER_DISABLED',
                    severity: saved.enabled ? NotificationSeverity.SUCCESS : NotificationSeverity.WARNING,
                    businessAccountId,
                    relatedEntityType: 'BusinessAiSettings',
                    relatedEntityId: saved.id,
                    titleFa: saved.enabled ? '✅ پاسخ‌گویی هوشمند فعال شد' : '⏸ پاسخ‌گویی هوشمند متوقف شد',
                    summaryFa: saved.enabled
                        ? 'پاسخ خودکار برای پیام‌های جدید فعال است.'
                        : 'پاسخ خودکار برای این کسب‌وکار غیرفعال شد.',
                    destinationPath: `/settings?business=${encodeURIComponent(businessAccountId)}`,
                });
            }
            return saved;
        });
        return this.aiSettings(context, businessAccountId);
    }
    async aiBacklog(context, businessAccountId) {
        requireBusiness(context, businessAccountId);
        const now = new Date();
        const jobs = await this.prisma.conversationJob.findMany({
            where: {
                status: 'WAITING_FOR_AI_AVAILABILITY',
                conversation: { businessAccountId },
            },
            orderBy: { createdAt: 'asc' },
            include: {
                message: { select: { sentAt: true } },
                conversation: {
                    include: {
                        customer: true,
                        messages: {
                            where: { processingStatus: 'WAITING_FOR_AI_AVAILABILITY' },
                            select: { id: true },
                        },
                    },
                },
            },
        });
        const grouped = new Map();
        for (const job of jobs)
            if (!grouped.has(job.conversationId))
                grouped.set(job.conversationId, job);
        const availability = this.availability
            ? await this.availability.check({ businessAccountId })
            : null;
        return {
            waitingConversations: grouped.size,
            oldestWaitingAt: jobs[0]?.message.sentAt ?? null,
            nextAiActivationAt: availability?.nextTransitionReason === 'ACTIVATES' ? availability.nextTransitionAt : null,
            aiAvailable: availability?.available ?? false,
            conversations: [...grouped.values()].map((job) => ({
                conversationId: job.conversationId,
                customer: {
                    name: customerName(job.conversation.customer),
                    username: job.conversation.customer.username,
                },
                queuedMessageCount: job.conversation.messages.length,
                waitingReason: job.waitingReason,
                oldestWaitingAt: job.message.sentAt,
                mode: job.conversation.mode,
                replyWindowOpen: Boolean(job.conversation.telegramReplyWindowExpiresAt &&
                    job.conversation.telegramReplyWindowExpiresAt > now),
                replyWindowExpiresAt: job.conversation.telegramReplyWindowExpiresAt,
            })),
        };
    }
    async manageAiBacklog(context, businessAccountId, conversationId, action) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        const conversation = await this.prisma.conversation.findFirst({
            where: { id: conversationId, businessAccountId },
        });
        if (!conversation)
            throw new ResourceUnavailableError();
        if (action === 'handoff') {
            await this.handoffs.activate(conversationId, 'ADMIN_BACKLOG_HANDOFF', 'Backlog manually handed off');
            await this.prisma.conversationJob.updateMany({
                where: { conversationId, status: 'WAITING_FOR_AI_AVAILABILITY' },
                data: { status: 'CANCELLED_BY_HUMAN', lastErrorCode: 'ADMIN_HANDOFF' },
            });
            await this.prisma.message.updateMany({
                where: { conversationId, processingStatus: 'WAITING_FOR_AI_AVAILABILITY' },
                data: { processingStatus: 'CANCELLED_BY_HUMAN', processingErrorCode: 'ADMIN_HANDOFF' },
            });
            return;
        }
        if (action === 'cancel') {
            await this.prisma.conversationJob.updateMany({
                where: { conversationId, status: 'WAITING_FOR_AI_AVAILABILITY' },
                data: { status: 'SUPERSEDED', lastErrorCode: 'ADMIN_CANCELLED' },
            });
            await this.prisma.message.updateMany({
                where: { conversationId, processingStatus: 'WAITING_FOR_AI_AVAILABILITY' },
                data: { processingStatus: 'SUPERSEDED', processingErrorCode: 'ADMIN_CANCELLED' },
            });
            return;
        }
        if (!this.availability)
            throw new AppError('Availability service missing', 'INTERNAL_ERROR');
        const current = await this.availability.check({ businessAccountId, conversationId });
        if (!current.available)
            throw new AppError('AI is unavailable', 'AI_UNAVAILABLE', 409);
        await this.prisma.conversationJob.updateMany({
            where: { conversationId, status: 'WAITING_FOR_AI_AVAILABILITY' },
            data: { status: 'READY', processAfter: new Date(), waitingReason: null },
        });
        await this.prisma.message.updateMany({
            where: { conversationId, processingStatus: 'WAITING_FOR_AI_AVAILABILITY' },
            data: { processingStatus: 'READY', processingErrorCode: null },
        });
    }
    async notifications(context) {
        const businessAccountIds = context.businessAccess
            .filter((access) => access.businessAccount.isActive)
            .map((access) => access.businessAccountId);
        const deliveries = await this.prisma.notificationDelivery.findMany({
            where: {
                adminId: context.admin.id,
                notification: {
                    OR: [{ businessAccountId: null }, { businessAccountId: { in: businessAccountIds } }],
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: { notification: true },
        });
        return deliveries.map((delivery) => ({
            id: delivery.id,
            status: delivery.status,
            readAt: delivery.readAt,
            createdAt: delivery.createdAt,
            notification: {
                type: delivery.notification.type,
                severity: delivery.notification.severity,
                title: delivery.notification.titleFa,
                summary: delivery.notification.summaryFa,
                destinationPath: delivery.notification.destinationPath,
            },
        }));
    }
    async markNotificationRead(context, deliveryId) {
        const businessAccountIds = context.businessAccess
            .filter((access) => access.businessAccount.isActive)
            .map((access) => access.businessAccountId);
        const changed = await this.prisma.notificationDelivery.updateMany({
            where: {
                id: deliveryId,
                adminId: context.admin.id,
                notification: {
                    OR: [{ businessAccountId: null }, { businessAccountId: { in: businessAccountIds } }],
                },
            },
            data: { readAt: new Date() },
        });
        if (changed.count !== 1)
            throw new ResourceUnavailableError();
    }
    async setKnowledgeActive(context, businessAccountId, knowledgeId, isActive) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        return this.knowledge.setActive(businessAccountId, knowledgeId, isActive, context.admin.id);
    }
    async deleteKnowledge(context, businessAccountId, knowledgeId) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        return this.knowledge.delete(businessAccountId, knowledgeId, context.admin.id);
    }
    async retryKnowledge(context, businessAccountId, knowledgeId) {
        requireRole(context, AdminRole.ADMIN);
        requireBusiness(context, businessAccountId);
        await this.knowledge.retryIndexing(businessAccountId, knowledgeId, context.admin.id);
    }
    async claimHandoff(context, businessAccountId, conversationId) {
        requireBusiness(context, businessAccountId);
        await this.handoffs.claim(businessAccountId, conversationId, context.admin);
    }
    async acknowledgeHandoff(context, businessAccountId, conversationId) {
        requireBusiness(context, businessAccountId);
        await this.handoffs.acknowledge(businessAccountId, conversationId, context.admin);
    }
    async extendHandoff(context, businessAccountId, conversationId) {
        requireBusiness(context, businessAccountId);
        return this.handoffs.extend(businessAccountId, conversationId, context.admin);
    }
    async enableAi(context, businessAccountId, conversationId) {
        requireBusiness(context, businessAccountId);
        const changed = await this.handoffs.enableAiNow(businessAccountId, conversationId, context.admin);
        if (!changed)
            throw new AppError('Conversation mode has changed', 'STATE_CONFLICT', 409);
    }
    async resolveHandoff(context, businessAccountId, conversationId, input) {
        requireBusiness(context, businessAccountId);
        const allowed = [
            'ANSWERED_BY_SUPPORT',
            'CUSTOMER_NEED_RESOLVED',
            'CUSTOMER_NO_RESPONSE',
            'INCORRECT_HANDOFF',
            'SERVICE_ISSUE',
            'OTHER',
        ];
        if (!allowed.includes(input.outcome)) {
            throw new ValidationError('Resolution outcome is invalid', 'INVALID_RESOLUTION_OUTCOME');
        }
        if (input.note && input.note.length > 2_000) {
            throw new ValidationError('Resolution note is too long', 'INVALID_RESOLUTION_NOTE');
        }
        await this.handoffs.resolve(businessAccountId, conversationId, context.admin, input.outcome, input.note);
    }
    async systemLogs(context, businessAccountId, filters) {
        requireBusiness(context, businessAccountId);
        requireRole(context, AdminRole.ADMIN);
        if (!this.systemLogger)
            throw new ResourceUnavailableError();
        const levels = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
        const cats = [
            'WEBHOOK',
            'TELEGRAM',
            'AI',
            'RETRIEVAL',
            'INDEXING',
            'QDRANT',
            'WORKER',
            'HANDOFF',
            'AUTH',
            'SYSTEM',
            'CREDIT',
            'DATABASE',
            'HTTP',
        ];
        const level = levels.find((v) => v === filters.level?.toUpperCase()) ?? null;
        const category = cats.find((v) => v === filters.category?.toUpperCase()) ?? null;
        const page = filters.page ? Math.max(1, Number(filters.page) || 1) : 1;
        const pageSize = filters.pageSize
            ? Math.min(100, Math.max(1, Number(filters.pageSize) || 20))
            : 20;
        const from = filters.from ? new Date(filters.from) : null;
        const to = filters.to ? new Date(filters.to) : null;
        return this.systemLogger.list({
            businessAccountId,
            level,
            category,
            errorCode: filters.errorCode ?? null,
            search: filters.search ?? null,
            from: from && !Number.isNaN(from.getTime()) ? from : null,
            to: to && !Number.isNaN(to.getTime()) ? to : null,
            page,
            pageSize,
        });
    }
    async systemLogDetail(context, businessAccountId, id) {
        requireBusiness(context, businessAccountId);
        requireRole(context, AdminRole.ADMIN);
        if (!this.systemLogger)
            throw new ResourceUnavailableError();
        const item = await this.systemLogger.get(id);
        if (!item)
            throw new ResourceUnavailableError();
        const row = item;
        if (row.businessAccountId && row.businessAccountId !== businessAccountId)
            throw new ResourceUnavailableError();
        return item;
    }
    async diagnostics(context, businessAccountId) {
        requireBusiness(context, businessAccountId);
        const showDiag = context.admin.role !== AdminRole.SUPPORT;
        const [health, logs] = await Promise.all([
            this.health.readiness(),
            showDiag && this.systemLogger
                ? this.systemLogger.summary({ businessAccountId, sinceHours: 24 })
                : Promise.resolve(null),
        ]);
        const queues = showDiag
            ? await Promise.all([
                this.prisma.indexingJob.groupBy({
                    by: ['status'],
                    where: { knowledgeItem: { businessAccountId } },
                    _count: true,
                }),
                this.prisma.conversationJob.groupBy({
                    by: ['status'],
                    where: { message: { conversation: { businessAccountId } } },
                    _count: true,
                }),
            ])
            : null;
        return {
            health,
            queues: queues ? { indexing: queues[0], conversations: queues[1] } : undefined,
            logs,
            generatedAt: new Date().toISOString(),
        };
    }
}
//# sourceMappingURL=service.js.map