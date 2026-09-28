import { type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { EmbeddingProvider } from '../ai/openai.js';
import type { DetailedRetrieval, RetrievalResult } from '../domain/types.js';
import type { VectorStore } from './qdrant.js';
export declare class RetrievalService {
    #private;
    private readonly prisma;
    private readonly embeddings;
    private readonly vectors;
    private readonly config;
    private readonly logger?;
    constructor(prisma: PrismaClient, embeddings: EmbeddingProvider, vectors: VectorStore, config: AppConfig, logger?: Logger | undefined);
    search(businessAccountId: string, question: string): Promise<RetrievalResult[]>;
    searchDetailed(businessAccountId: string, question: string): Promise<DetailedRetrieval>;
}
