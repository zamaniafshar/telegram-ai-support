import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { EmbeddingProvider } from '../ai/openai.js';
import type { ExactAnswerMatcher, ExactAnswerMatchResult } from '../domain/types.js';
import type { VectorStore } from '../retrieval/qdrant.js';
export interface CreateExactAnswerInput {
    businessAccountId: string;
    name: string;
    content: string;
    questions: string[];
    adminId?: string | undefined;
    isActive?: boolean | undefined;
}
export interface UpdateExactAnswerInput {
    name?: string | undefined;
    content?: string | undefined;
    isActive?: boolean | undefined;
    questions?: string[] | undefined;
    adminId?: string | undefined;
}
export declare class ExactAnswerService implements ExactAnswerMatcher {
    private readonly prisma;
    private readonly embeddings;
    private readonly vectors;
    private readonly logger?;
    constructor(prisma: PrismaClient, embeddings: EmbeddingProvider, vectors: VectorStore, logger?: Logger | undefined);
    match(input: {
        vector: number[];
        businessAccountId: string;
        threshold: number;
    }): Promise<ExactAnswerMatchResult | null>;
    create(input: CreateExactAnswerInput): Promise<{
        questions: {
            id: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
            exactAnswerId: string;
            questionText: string;
            qdrantPointId: string;
        }[];
    } & {
        businessAccountId: string;
        name: string;
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        createdByAdminId: string | null;
        updatedByAdminId: string | null;
        content: string;
    }>;
    update(id: string, businessAccountId: string, input: UpdateExactAnswerInput): Promise<{
        questions: {
            id: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
            exactAnswerId: string;
            questionText: string;
            qdrantPointId: string;
        }[];
    } & {
        businessAccountId: string;
        name: string;
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        createdByAdminId: string | null;
        updatedByAdminId: string | null;
        content: string;
    }>;
    delete(id: string, businessAccountId: string): Promise<void>;
    reindex(businessAccountId?: string): Promise<number>;
    list(businessAccountId: string, query?: string): Promise<({
        questions: {
            id: string;
            isActive: boolean;
            questionText: string;
        }[];
    } & {
        businessAccountId: string;
        name: string;
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        createdByAdminId: string | null;
        updatedByAdminId: string | null;
        content: string;
    })[]>;
    get(id: string, businessAccountId: string): Promise<({
        createdByAdmin: {
            id: string;
            displayName: string | null;
        } | null;
        updatedByAdmin: {
            id: string;
            displayName: string | null;
        } | null;
        questions: {
            id: string;
            isActive: boolean;
            createdAt: Date;
            questionText: string;
        }[];
    } & {
        businessAccountId: string;
        name: string;
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        createdByAdminId: string | null;
        updatedByAdminId: string | null;
        content: string;
    }) | null>;
}
