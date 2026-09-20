import { IndexingStatus } from '@prisma/client';
const MAX_KNOWLEDGE_CONTEXT_CHUNKS = 20;
const MAX_KNOWLEDGE_CONTEXT_CHARS = 24_000;
export class RetrievalService {
    prisma;
    embeddings;
    vectors;
    config;
    constructor(prisma, embeddings, vectors, config) {
        this.prisma = prisma;
        this.embeddings = embeddings;
        this.vectors = vectors;
        this.config = config;
    }
    async search(businessAccountId, question) {
        const result = await this.searchDetailed(businessAccountId, question);
        return result.validated;
    }
    async searchDetailed(businessAccountId, question) {
        const started = Date.now();
        const [vector] = await this.embeddings.embed([question]);
        if (!vector)
            return { raw: [], validated: [], latencyMs: Date.now() - started };
        const candidates = await this.vectors.search({
            vector,
            businessAccountId,
            minScore: this.config.rag.retrievalMinScore,
            limit: this.config.rag.retrievalLimit,
        });
        if (candidates.length === 0) {
            return { raw: [], validated: [], latencyMs: Date.now() - started };
        }
        const knowledgeIds = [...new Set(candidates.map((item) => item.knowledgeId))];
        const current = await this.prisma.knowledgeItem.findMany({
            where: {
                id: { in: knowledgeIds },
                businessAccountId,
                isActive: true,
                deletedAt: null,
                indexingStatus: IndexingStatus.READY,
            },
            select: { id: true, version: true, title: true },
        });
        const currentVersions = new Map(current.map((item) => [item.id, item.version]));
        const raw = candidates.map((item, index) => {
            const currentVersion = currentVersions.get(item.knowledgeId);
            const rejectionReason = currentVersion === undefined
                ? 'KNOWLEDGE_MISSING_OR_INACTIVE'
                : currentVersion !== item.knowledgeVersion
                    ? 'VERSION_MISMATCH'
                    : null;
            return { ...item, rank: index + 1, validated: rejectionReason === null, rejectionReason };
        });
        const validatedSeeds = raw.filter((item) => item.validated);
        const validated = await this.#expandMatchedKnowledge(validatedSeeds, current);
        return {
            raw,
            validated,
            latencyMs: Date.now() - started,
        };
    }
    async #expandMatchedKnowledge(seeds, currentItems) {
        if (seeds.length === 0)
            return [];
        const matchedKnowledgeIds = [...new Set(seeds.map((item) => item.knowledgeId))];
        const currentById = new Map(currentItems.map((item) => [item.id, item]));
        const matchedItems = matchedKnowledgeIds.flatMap((id) => {
            const item = currentById.get(id);
            return item ? [item] : [];
        });
        const chunks = await this.prisma.knowledgeChunk.findMany({
            where: {
                isActive: true,
                OR: matchedItems.map((item) => ({
                    knowledgeItemId: item.id,
                    knowledgeVersion: item.version,
                })),
            },
            select: {
                id: true,
                knowledgeItemId: true,
                knowledgeVersion: true,
                chunkIndex: true,
                content: true,
            },
            orderBy: [{ knowledgeItemId: 'asc' }, { chunkIndex: 'asc' }],
        });
        const selected = new Map(seeds.map((item) => [item.chunkId, item]));
        let selectedChars = [...selected.values()].reduce((total, item) => total + item.content.length, 0);
        for (const knowledgeId of matchedKnowledgeIds) {
            const itemChunks = chunks.filter((chunk) => chunk.knowledgeItemId === knowledgeId);
            const missingChunks = itemChunks.filter((chunk) => !selected.has(chunk.id));
            const missingChars = missingChunks.reduce((total, chunk) => total + chunk.content.length, 0);
            if (selected.size + missingChunks.length > MAX_KNOWLEDGE_CONTEXT_CHUNKS ||
                selectedChars + missingChars > MAX_KNOWLEDGE_CONTEXT_CHARS) {
                continue;
            }
            const bestSeed = seeds.find((seed) => seed.knowledgeId === knowledgeId);
            const currentItem = currentById.get(knowledgeId);
            if (!bestSeed || !currentItem)
                continue;
            for (const chunk of missingChunks) {
                selected.set(chunk.id, {
                    chunkId: chunk.id,
                    knowledgeId,
                    title: currentItem.title,
                    content: chunk.content,
                    score: bestSeed.score,
                    knowledgeVersion: chunk.knowledgeVersion,
                    rank: bestSeed.rank,
                    validated: true,
                    rejectionReason: null,
                });
            }
            selectedChars += missingChars;
        }
        const chunkIndexes = new Map(chunks.map((chunk) => [chunk.id, chunk.chunkIndex]));
        const knowledgeOrder = new Map(matchedKnowledgeIds.map((id, index) => [id, index]));
        return [...selected.values()].sort((left, right) => {
            const itemOrder = (knowledgeOrder.get(left.knowledgeId) ?? Number.MAX_SAFE_INTEGER) -
                (knowledgeOrder.get(right.knowledgeId) ?? Number.MAX_SAFE_INTEGER);
            if (itemOrder !== 0)
                return itemOrder;
            return ((chunkIndexes.get(left.chunkId) ?? left.rank) -
                (chunkIndexes.get(right.chunkId) ?? right.rank));
        });
    }
}
//# sourceMappingURL=service.js.map