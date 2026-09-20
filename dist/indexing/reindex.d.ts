import { type PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import type { EmbeddingProvider } from '../ai/openai.js';
import type { VectorStore } from '../retrieval/qdrant.js';
export declare function embeddingDimensions(config: AppConfig, embeddings: EmbeddingProvider): Promise<number>;
export declare function enqueueFullReindex(prisma: PrismaClient, vectors: VectorStore, embeddings: EmbeddingProvider, config: AppConfig): Promise<number>;
