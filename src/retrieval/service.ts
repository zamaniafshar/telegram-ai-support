import { IndexingStatus, type PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import type { EmbeddingProvider } from '../ai/openai.js';
import type { RetrievalResult } from '../domain/types.js';
import type { VectorStore } from './qdrant.js';

export class RetrievalService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectors: VectorStore,
    private readonly config: AppConfig,
  ) {}

  async search(businessAccountId: string, question: string): Promise<RetrievalResult[]> {
    const [vector] = await this.embeddings.embed([question]);
    if (!vector) return [];
    const candidates = await this.vectors.search({
      vector,
      businessAccountId,
      minScore: this.config.rag.retrievalMinScore,
      limit: this.config.rag.retrievalLimit,
    });
    if (candidates.length === 0) return [];

    const knowledgeIds = [...new Set(candidates.map((item) => item.knowledgeId))];
    const current = await this.prisma.knowledgeItem.findMany({
      where: {
        id: { in: knowledgeIds },
        businessAccountId,
        isActive: true,
        deletedAt: null,
        indexingStatus: IndexingStatus.READY,
      },
      select: { id: true, version: true },
    });
    const currentVersions = new Map(current.map((item) => [item.id, item.version]));
    return candidates.filter(
      (item) => currentVersions.get(item.knowledgeId) === item.knowledgeVersion,
    );
  }
}
