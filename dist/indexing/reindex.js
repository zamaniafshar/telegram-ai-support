import { IndexingAction, IndexingJobStatus, IndexingStatus, } from '@prisma/client';
import { newId } from '../utils/ids.js';
export async function embeddingDimensions(config, embeddings) {
    if (config.openai.embeddingDimensions)
        return config.openai.embeddingDimensions;
    const [probe] = await embeddings.embed(['embedding dimension probe']);
    if (!probe?.length)
        throw new Error('Embedding API returned no dimension probe');
    return probe.length;
}
export async function enqueueFullReindex(prisma, vectors, embeddings, config) {
    const dimensions = await embeddingDimensions(config, embeddings);
    await vectors.recreateCollection(dimensions);
    const items = await prisma.knowledgeItem.findMany({ where: { deletedAt: null } });
    await prisma.$transaction(async (tx) => {
        await tx.knowledgeChunk.updateMany({ data: { isActive: false } });
        for (const item of items) {
            if (!item.isActive)
                continue;
            await tx.knowledgeItem.update({
                where: { id: item.id },
                data: { indexingStatus: IndexingStatus.PENDING, indexingError: null },
            });
            const dedupeKey = `${item.id}:${item.version}:${IndexingAction.UPSERT}`;
            await tx.indexingJob.upsert({
                where: { dedupeKey },
                create: {
                    id: newId(),
                    knowledgeItemId: item.id,
                    knowledgeVersion: item.version,
                    action: IndexingAction.UPSERT,
                    dedupeKey,
                    maxAttempts: config.worker.indexingMaxAttempts,
                },
                update: {
                    status: IndexingJobStatus.PENDING,
                    attempts: 0,
                    availableAt: new Date(),
                    completedAt: null,
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    lastErrorCode: null,
                    lastErrorDetail: null,
                },
            });
        }
    });
    return items.filter((item) => item.isActive).length;
}
//# sourceMappingURL=reindex.js.map