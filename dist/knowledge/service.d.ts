import { IndexingJobStatus, type KnowledgeDraft, type KnowledgeItem, type PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import type { KnowledgeInput } from '../domain/types.js';
export declare class KnowledgeService {
    #private;
    private readonly prisma;
    private readonly config;
    constructor(prisma: PrismaClient, config: AppConfig);
    create(input: KnowledgeInput, adminId: string): Promise<KnowledgeItem>;
    update(businessAccountId: string, id: string, patch: {
        title?: string;
        description?: string;
    }, adminId: string): Promise<KnowledgeItem>;
    setActive(businessAccountId: string, id: string, isActive: boolean, adminId: string): Promise<KnowledgeItem>;
    delete(businessAccountId: string, id: string, adminId: string): Promise<{
        cleanupJobId: string;
        cleanupStatus: IndexingJobStatus;
        alreadyDeleted: boolean;
    }>;
    retryIndexing(businessAccountId: string, id: string, adminId: string): Promise<void>;
    get(businessAccountId: string, id: string): Promise<KnowledgeItem | null>;
    list(businessAccountId: string, page?: number, pageSize?: number, query?: string): Promise<{
        items: {
            businessAccountId: string;
            id: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
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
        total: number;
        page: number;
        pageSize: number;
    }>;
    createDraft(businessAccountId: string, adminId: string, knowledgeItemId?: string): Promise<KnowledgeDraft>;
    updateDraft(businessAccountId: string, draftId: string, expectedRevision: number, patch: {
        title?: string;
        description?: string;
    }, adminId: string): Promise<KnowledgeDraft>;
    getDraft(businessAccountId: string, draftId: string): Promise<KnowledgeDraft | null>;
    listDrafts(businessAccountId: string): Promise<KnowledgeDraft[]>;
    publishDraft(businessAccountId: string, draftId: string, expectedRevision: number, adminId: string): Promise<KnowledgeItem>;
    private requireActiveRecord;
}
