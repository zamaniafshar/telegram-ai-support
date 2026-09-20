import { type Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { EmbeddingProvider } from '../ai/openai.js';
import type { VectorStore } from '../retrieval/qdrant.js';
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
    indexingSucceededInTransaction?(client: Prisma.TransactionClient, input: {
        businessAccountId: string;
        knowledgeId: string;
        title: string;
        chunkCount: number;
        knowledgeVersion?: number;
    }): Promise<void>;
    indexingFailedInTransaction?(client: Prisma.TransactionClient, input: {
        businessAccountId: string;
        knowledgeId: string;
        title: string;
        errorCode: string;
        knowledgeVersion?: number;
    }): Promise<void>;
}
export declare class IndexingService {
    #private;
    private readonly prisma;
    private readonly embeddings;
    private readonly vectors;
    private readonly config;
    private readonly logger;
    private readonly notifier?;
    constructor(prisma: PrismaClient, embeddings: EmbeddingProvider, vectors: VectorStore, config: AppConfig, logger: Logger, notifier?: IndexingNotifier | undefined);
    runBatch(workerId: string): Promise<number>;
}
