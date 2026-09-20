import { AdminRole, type Prisma, type PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import type { HandoffService } from '../handoffs/service.js';
import type { KnowledgeService } from '../knowledge/service.js';
import type { HealthService } from '../observability/health.js';
import type { MiniAppSessionContext } from './auth.js';
import { type AiAvailabilityService, type WeeklySchedule, type QueuePolicy } from '../ai/availability.js';
import type { AdminNotifier } from '../telegram-admin/notifier.js';
export declare class MiniAppManagementService {
    #private;
    private readonly prisma;
    private readonly knowledge;
    private readonly handoffs;
    private readonly health;
    private readonly config;
    private readonly availability?;
    private readonly notifier?;
    constructor(prisma: PrismaClient, knowledge: KnowledgeService, handoffs: HandoffService, health: HealthService, config: AppConfig, availability?: AiAvailabilityService | undefined, notifier?: AdminNotifier | undefined);
    businesses(context: MiniAppSessionContext): {
        id: string;
        name: string;
        locale: string;
    }[];
    dashboard(context: MiniAppSessionContext, businessAccountId: string): Promise<{
        business: {
            id: string;
            name: string;
            locale: string;
        };
        metrics: {
            waitingHandoffs: number;
            humanConversations: number;
            failedKnowledge: number;
            conversationsToday: number;
        };
        connection: {
            updatedAt: Date;
            enabled: boolean;
            canReply: boolean;
            status: string;
        } | {
            status: string;
            enabled: boolean;
            canReply: boolean;
            updatedAt: null;
        };
        recentHandoffs: {
            id: string;
            conversationId: string;
            status: import("@prisma/client").$Enums.HandoffStatus;
            customerName: string;
            startedAt: Date;
            expiresAt: Date;
            claimed: boolean;
        }[];
    }>;
    analyticsOverview(context: MiniAppSessionContext, businessAccountId: string, options: {
        from?: Date | undefined;
        to?: Date | undefined;
        outcome?: string | undefined;
    }): Promise<{
        totalProcessed: number;
        answersSent: number;
        handoffs: number;
        failedOrSuppressed: number;
        averageResponseTimeMs: number | null;
        averageRetrievalScore: number | null;
        tokens: {
            input: number;
            output: number;
            total: number;
        };
        estimatedCostUsd: number | null;
    }>;
    analyticsTraces(context: MiniAppSessionContext, businessAccountId: string, options: {
        from?: Date | undefined;
        to?: Date | undefined;
        outcome?: string | undefined;
        page: number;
        pageSize: number;
    }): Promise<{
        items: {
            id: string;
            customerMessagePreview: string;
            decision: string | null;
            answerable: boolean | null;
            outcome: import("@prisma/client").$Enums.AiTraceOutcome;
            confidence: number | null;
            topRetrievalScore: number | null;
            latencyMs: number | null;
            createdAt: Date;
        }[];
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    }>;
    analyticsTraceDetails(context: MiniAppSessionContext, businessAccountId: string, traceId: string): Promise<{
        id: string;
        createdAt: Date;
        completedAt: Date | null;
        customerMessages: Record<string, unknown>[];
        conversationContext: Record<string, unknown>[] | null;
        retrieval: {
            raw: Record<string, unknown>[];
            validated: Record<string, unknown>[];
            sentToAi: Record<string, unknown>[] | null;
            citedChunkIds: string[];
            chunks: {
                validated: boolean;
                sentToAi: boolean | null;
                citedByAi: boolean;
            }[];
            latencyMs: number | null;
        };
        ai: {
            decision: string | null;
            answerable: boolean | null;
            confidence: number | null;
            reason: string | null;
            answer: string | null;
            model: string | null;
            promptVersion: string | null;
            tokens: {
                input: number | null;
                output: number | null;
                total: number | null;
            };
            latencyMs: number;
        };
        outcome: {
            status: import("@prisma/client").$Enums.AiTraceOutcome;
            reason: string | null;
            errorCode: string | null;
            totalLatencyMs: number | null;
        };
        permissions: {
            canViewPromptInternals: boolean;
        };
    }>;
    listHandoffs(context: MiniAppSessionContext, businessAccountId: string, options: {
        status?: string | undefined;
        query?: string | undefined;
    }): Promise<{
        id: string;
        conversationId: string;
        status: import("@prisma/client").$Enums.HandoffStatus;
        reasonCode: string;
        startedAt: Date;
        expiresAt: Date | null;
        claimedBy: string | null;
        customer: {
            name: string;
            username: string | null;
            telegramUserId: string;
        };
        mode: import("@prisma/client").$Enums.ConversationMode;
        updatedAt: Date;
        lastMessage: {
            id: string;
            senderType: import("@prisma/client").$Enums.SenderType;
            text: string | null;
            sentAt: Date;
        } | null;
    }[]>;
    handoffDetails(context: MiniAppSessionContext, businessAccountId: string, conversationId: string): Promise<{
        id: string;
        mode: import("@prisma/client").$Enums.ConversationMode;
        humanModeExpiresAt: Date | null;
        replyWindowExpiresAt: Date | null;
        customer: {
            name: string;
            username: string | null;
            telegramUserId: string;
            languageCode: string | null;
        };
        activeHandoff: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            conversationId: string;
            expiresAt: Date;
            status: import("@prisma/client").$Enums.HandoffStatus;
            reasonCode: string;
            reasonDetail: string | null;
            activeKey: string | null;
            startedAt: Date;
            acknowledgedAt: Date | null;
            acknowledgedBy: string | null;
            claimedAt: Date | null;
            claimedBy: string | null;
            resolvedAt: Date | null;
            resolvedBy: string | null;
            resolutionOutcome: string | null;
            resolutionNote: string | null;
        } | null;
        history: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            conversationId: string;
            expiresAt: Date;
            status: import("@prisma/client").$Enums.HandoffStatus;
            reasonCode: string;
            reasonDetail: string | null;
            activeKey: string | null;
            startedAt: Date;
            acknowledgedAt: Date | null;
            acknowledgedBy: string | null;
            claimedAt: Date | null;
            claimedBy: string | null;
            resolvedAt: Date | null;
            resolvedBy: string | null;
            resolutionOutcome: string | null;
            resolutionNote: string | null;
        }[];
        messages: {
            id: string;
            senderType: import("@prisma/client").$Enums.SenderType;
            text: string | null;
            editedAt: Date | null;
            sentAt: Date;
        }[];
        capabilities: {
            canClaim: boolean;
            canAcknowledge: boolean;
            canExtend: boolean;
            canResolve: boolean;
            canEnableAi: boolean;
        };
    }>;
    listConversations(context: MiniAppSessionContext, businessAccountId: string, options: {
        mode?: string | undefined;
        query?: string | undefined;
    }): Promise<{
        id: string;
        customer: {
            name: string;
            username: string | null;
        };
        mode: import("@prisma/client").$Enums.ConversationMode;
        updatedAt: Date;
        replyWindowExpiresAt: Date | null;
        lastMessage: {
            senderType: import("@prisma/client").$Enums.SenderType;
            text: string | null;
            processingStatus: import("@prisma/client").$Enums.MessageProcessingStatus;
            sentAt: Date;
        } | null;
        hasActiveHandoff: boolean;
    }[]>;
    conversationDetails(context: MiniAppSessionContext, businessAccountId: string, conversationId: string): Promise<{
        id: string;
        mode: import("@prisma/client").$Enums.ConversationMode;
        updatedAt: Date;
        humanModeExpiresAt: Date | null;
        replyWindowExpiresAt: Date | null;
        customer: {
            name: string;
            username: string | null;
            telegramUserId: string;
        };
        messages: {
            processingErrorCode: string | null | undefined;
            id: string;
            senderType: import("@prisma/client").$Enums.SenderType;
            direction: import("@prisma/client").$Enums.MessageDirection;
            text: string | null;
            editedAt: Date | null;
            processingStatus: import("@prisma/client").$Enums.MessageProcessingStatus;
            sentAt: Date;
        }[];
        handoffs: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            conversationId: string;
            expiresAt: Date;
            status: import("@prisma/client").$Enums.HandoffStatus;
            reasonCode: string;
            reasonDetail: string | null;
            activeKey: string | null;
            startedAt: Date;
            acknowledgedAt: Date | null;
            acknowledgedBy: string | null;
            claimedAt: Date | null;
            claimedBy: string | null;
            resolvedAt: Date | null;
            resolvedBy: string | null;
            resolutionOutcome: string | null;
            resolutionNote: string | null;
        }[];
        aiDecisions: {
            reason?: string | null;
            model?: string | null;
            promptVersion?: string;
            totalTokens?: number | null;
            errorCode?: string | null;
            supportingChunkIds?: Prisma.JsonValue;
            id: string;
            answerable: boolean | null;
            confidence: number | null;
            createdAt: Date;
            latencyMs: number;
        }[];
    }>;
    listKnowledge(context: MiniAppSessionContext, businessAccountId: string, options: {
        query?: string | undefined;
    }): Promise<{
        published: {
            id: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
            businessAccountId: string;
            title: string;
            description: string;
            version: number;
            indexingStatus: import("@prisma/client").$Enums.IndexingStatus;
            indexingError: string | null;
            deletedAt: Date | null;
            createdByAdminId: string | null;
            updatedByAdminId: string | null;
            indexingLeaseOwner: string | null;
            indexingLeaseExpiresAt: Date | null;
        }[];
        drafts: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            businessAccountId: string;
            title: string;
            description: string;
            createdByAdminId: string;
            updatedByAdminId: string;
            knowledgeItemId: string | null;
            revision: number;
        }[];
    }>;
    knowledgeDetails(context: MiniAppSessionContext, businessAccountId: string, knowledgeId: string): Promise<{
        item: {
            id: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
            businessAccountId: string;
            title: string;
            description: string;
            version: number;
            indexingStatus: import("@prisma/client").$Enums.IndexingStatus;
            indexingError: string | null;
            deletedAt: Date | null;
            createdByAdminId: string | null;
            updatedByAdminId: string | null;
            indexingLeaseOwner: string | null;
            indexingLeaseExpiresAt: Date | null;
        };
        chunks: {
            id: string;
            isActive: boolean;
            chunkIndex: number;
            knowledgeVersion: number;
            content: string;
        }[];
        jobs: {
            id: string;
            createdAt: Date;
            completedAt: Date | null;
            status: import("@prisma/client").$Enums.IndexingJobStatus;
            attempts: number;
            maxAttempts: number;
            lastErrorCode: string | null;
        }[];
        draft: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            businessAccountId: string;
            title: string;
            description: string;
            createdByAdminId: string;
            updatedByAdminId: string;
            knowledgeItemId: string | null;
            revision: number;
        } | null;
    }>;
    createKnowledgeDraft(context: MiniAppSessionContext, businessAccountId: string, knowledgeItemId?: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        businessAccountId: string;
        title: string;
        description: string;
        createdByAdminId: string;
        updatedByAdminId: string;
        knowledgeItemId: string | null;
        revision: number;
    }>;
    updateKnowledgeDraft(context: MiniAppSessionContext, businessAccountId: string, draftId: string, input: {
        revision: number;
        title?: string | undefined;
        description?: string | undefined;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        businessAccountId: string;
        title: string;
        description: string;
        createdByAdminId: string;
        updatedByAdminId: string;
        knowledgeItemId: string | null;
        revision: number;
    }>;
    knowledgeDraftDetails(context: MiniAppSessionContext, businessAccountId: string, draftId: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        businessAccountId: string;
        title: string;
        description: string;
        createdByAdminId: string;
        updatedByAdminId: string;
        knowledgeItemId: string | null;
        revision: number;
    }>;
    previewKnowledgeDraft(context: MiniAppSessionContext, businessAccountId: string, draftId: string): Promise<import("../knowledge/chunker.js").TextChunk[]>;
    publishKnowledgeDraft(context: MiniAppSessionContext, businessAccountId: string, draftId: string, revision: number): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        businessAccountId: string;
        title: string;
        description: string;
        version: number;
        indexingStatus: import("@prisma/client").$Enums.IndexingStatus;
        indexingError: string | null;
        deletedAt: Date | null;
        createdByAdminId: string | null;
        updatedByAdminId: string | null;
        indexingLeaseOwner: string | null;
        indexingLeaseExpiresAt: Date | null;
    }>;
    listConnections(context: MiniAppSessionContext, businessAccountId: string): Promise<{
        id: string | undefined;
        enabled: boolean;
        canReply: boolean;
        connectedAt: Date | null;
        disabledAt: Date | null;
        updatedAt: Date;
        rights: Prisma.JsonValue | undefined;
    }[]>;
    systemHealth(context: MiniAppSessionContext, businessAccountId: string): Promise<{
        ready: boolean;
        checks: {
            process: boolean;
            configuration: boolean;
            mysql: boolean;
            qdrant: boolean;
            businessWebhook: boolean;
            adminWebhook: boolean;
        } | undefined;
        queues: {
            indexing: (Prisma.PickEnumerable<Prisma.IndexingJobGroupByOutputType, "status"[]> & {
                _count: number;
            })[];
            conversations: (Prisma.PickEnumerable<Prisma.ConversationJobGroupByOutputType, "status"[]> & {
                _count: number;
            })[];
            notifications: (Prisma.PickEnumerable<Prisma.NotificationDeliveryGroupByOutputType, "status"[]> & {
                _count: number;
            })[];
        } | undefined;
        credit: {
            lastCheckedAt: Date | null;
            isLow: boolean;
        } | undefined;
        ai: {
            availability: import("../ai/availability.js").AiAvailabilityResult | null;
            suppressions: {
                [k: string]: number;
            };
            settingsChanges: number;
        };
    }>;
    listAdmins(context: MiniAppSessionContext, businessAccountId: string): Promise<{
        telegramUserId: string;
        protected: boolean;
        id: string;
        isActive: boolean;
        updatedAt: Date;
        displayName: string | null;
        role: import("@prisma/client").$Enums.AdminRole;
    }[]>;
    addAdmin(context: MiniAppSessionContext, businessAccountId: string, input: {
        telegramUserId: string;
        role: AdminRole;
        displayName?: string | undefined;
    }): Promise<{
        telegramUserId: string;
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        displayName: string | null;
        role: import("@prisma/client").$Enums.AdminRole;
        locale: string;
    }>;
    updateAdmin(context: MiniAppSessionContext, businessAccountId: string, targetId: string, input: {
        role?: AdminRole | undefined;
        isActive?: boolean | undefined;
    }): Promise<{
        telegramUserId: string;
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        displayName: string | null;
        role: import("@prisma/client").$Enums.AdminRole;
        locale: string;
    }>;
    removeAdminAccess(context: MiniAppSessionContext, businessAccountId: string, targetId: string): Promise<void>;
    audit(context: MiniAppSessionContext, businessAccountId: string, options: {
        action?: string | undefined;
    }): Promise<{
        id: string;
        createdAt: Date;
        businessAccountId: string | null;
        actorType: import("@prisma/client").$Enums.AuditActorType;
        actorId: string | null;
        action: string;
        entityType: string;
        entityId: string;
        metadata: Prisma.JsonValue | null;
        correlationId: string | null;
    }[]>;
    settings(context: MiniAppSessionContext, businessAccountId: string): {
        timezone: string;
        locale: string;
        humanModeHours: number;
        notifyAdditionalMessages: boolean;
        customerAcknowledgementEnabled: boolean;
        managedByDeployment: boolean;
    };
    aiSettings(context: MiniAppSessionContext, businessAccountId: string): Promise<{
        business: {
            id: string;
            name: string;
        };
        enabled: boolean;
        timezone: string;
        weeklySchedule: WeeklySchedule;
        outsideHoursPolicy: QueuePolicy;
        manualShutdownPolicy: QueuePolicy;
        backlogMaxAgeHours: number;
        version: number;
        updatedAt: Date | null;
        updatedBy: {
            id: string;
            displayName: string | null;
        } | null;
        lastChangeReason: string | null;
        canEdit: boolean;
        availability: import("../ai/availability.js").AiAvailabilityResult | null;
    }>;
    aiAvailability(context: MiniAppSessionContext, businessAccountId: string): Promise<import("../ai/availability.js").AiAvailabilityResult>;
    updateAiSettings(context: MiniAppSessionContext, businessAccountId: string, input: {
        enabled: boolean;
        timezone: string;
        weeklySchedule: WeeklySchedule;
        outsideHoursPolicy: QueuePolicy;
        manualShutdownPolicy: QueuePolicy;
        backlogMaxAgeHours: number;
        version: number;
        reason?: string | undefined;
    }, correlationId?: string): Promise<{
        business: {
            id: string;
            name: string;
        };
        enabled: boolean;
        timezone: string;
        weeklySchedule: WeeklySchedule;
        outsideHoursPolicy: QueuePolicy;
        manualShutdownPolicy: QueuePolicy;
        backlogMaxAgeHours: number;
        version: number;
        updatedAt: Date | null;
        updatedBy: {
            id: string;
            displayName: string | null;
        } | null;
        lastChangeReason: string | null;
        canEdit: boolean;
        availability: import("../ai/availability.js").AiAvailabilityResult | null;
    }>;
    aiBacklog(context: MiniAppSessionContext, businessAccountId: string): Promise<{
        waitingConversations: number;
        oldestWaitingAt: Date | null;
        nextAiActivationAt: Date | null;
        aiAvailable: boolean;
        conversations: {
            conversationId: string;
            customer: {
                name: string;
                username: string | null;
            };
            queuedMessageCount: number;
            waitingReason: string | null;
            oldestWaitingAt: Date;
            mode: import("@prisma/client").$Enums.ConversationMode;
            replyWindowOpen: boolean;
            replyWindowExpiresAt: Date | null;
        }[];
    }>;
    manageAiBacklog(context: MiniAppSessionContext, businessAccountId: string, conversationId: string, action: 'handoff' | 'cancel' | 'process-now'): Promise<void>;
    notifications(context: MiniAppSessionContext): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.NotificationDeliveryStatus;
        readAt: Date | null;
        createdAt: Date;
        notification: {
            type: string;
            severity: import("@prisma/client").$Enums.NotificationSeverity;
            title: string;
            summary: string;
            destinationPath: string;
        };
    }[]>;
    markNotificationRead(context: MiniAppSessionContext, deliveryId: string): Promise<void>;
    setKnowledgeActive(context: MiniAppSessionContext, businessAccountId: string, knowledgeId: string, isActive: boolean): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        businessAccountId: string;
        title: string;
        description: string;
        version: number;
        indexingStatus: import("@prisma/client").$Enums.IndexingStatus;
        indexingError: string | null;
        deletedAt: Date | null;
        createdByAdminId: string | null;
        updatedByAdminId: string | null;
        indexingLeaseOwner: string | null;
        indexingLeaseExpiresAt: Date | null;
    }>;
    deleteKnowledge(context: MiniAppSessionContext, businessAccountId: string, knowledgeId: string): Promise<{
        cleanupJobId: string;
        cleanupStatus: import("@prisma/client").IndexingJobStatus;
        alreadyDeleted: boolean;
    }>;
    retryKnowledge(context: MiniAppSessionContext, businessAccountId: string, knowledgeId: string): Promise<void>;
    claimHandoff(context: MiniAppSessionContext, businessAccountId: string, conversationId: string): Promise<void>;
    acknowledgeHandoff(context: MiniAppSessionContext, businessAccountId: string, conversationId: string): Promise<void>;
    extendHandoff(context: MiniAppSessionContext, businessAccountId: string, conversationId: string): Promise<Date>;
    enableAi(context: MiniAppSessionContext, businessAccountId: string, conversationId: string): Promise<void>;
    resolveHandoff(context: MiniAppSessionContext, businessAccountId: string, conversationId: string, input: {
        outcome: string;
        note?: string | undefined;
    }): Promise<void>;
}
