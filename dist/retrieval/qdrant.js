import { QdrantClient } from '@qdrant/js-client-rest';
export class QdrantVectorStore {
    config;
    client;
    constructor(config) {
        this.config = config;
        const qdrantUrl = new URL(config.qdrant.url);
        const port = qdrantUrl.port
            ? Number(qdrantUrl.port)
            : qdrantUrl.protocol === 'https:'
                ? 443
                : 6333;
        this.client = new QdrantClient({
            url: config.qdrant.url,
            port,
            ...(config.qdrant.apiKey ? { apiKey: config.qdrant.apiKey } : {}),
            timeout: config.qdrant.timeoutMs,
            checkCompatibility: false,
        });
    }
    async ensureCollection(dimensions) {
        const collections = await this.client.getCollections();
        if (!collections.collections.some((item) => item.name === this.config.qdrant.collection)) {
            await this.client.createCollection(this.config.qdrant.collection, {
                vectors: { size: dimensions, distance: 'Cosine' },
                on_disk_payload: true,
            });
        }
        else {
            const info = await this.client.getCollection(this.config.qdrant.collection);
            const vectors = info.config.params.vectors;
            const actualSize = vectors && 'size' in vectors && typeof vectors.size === 'number' ? vectors.size : undefined;
            if (actualSize !== undefined && actualSize !== dimensions) {
                throw new Error(`Qdrant collection dimension ${actualSize} does not match embedding dimension ${dimensions}`);
            }
        }
        const payloadIndexes = [
            { fieldName: 'businessAccountId', schema: 'keyword' },
            { fieldName: 'knowledgeId', schema: 'keyword' },
            { fieldName: 'chunkId', schema: 'keyword' },
            { fieldName: 'isActive', schema: 'bool' },
            { fieldName: 'knowledgeVersion', schema: 'integer' },
        ];
        for (const { fieldName, schema } of payloadIndexes) {
            await this.client
                .createPayloadIndex(this.config.qdrant.collection, {
                field_name: fieldName,
                field_schema: schema,
                wait: true,
            })
                .catch((error) => {
                if (!(error instanceof Error) || !/already exists/i.test(error.message))
                    throw error;
            });
        }
    }
    async recreateCollection(dimensions) {
        const collections = await this.client.getCollections();
        if (collections.collections.some((item) => item.name === this.config.qdrant.collection)) {
            await this.client.deleteCollection(this.config.qdrant.collection);
        }
        await this.ensureCollection(dimensions);
    }
    async healthy() {
        try {
            await this.client.getCollections();
            return true;
        }
        catch {
            return false;
        }
    }
    async upsert(points) {
        if (points.length === 0)
            return;
        await this.client.upsert(this.config.qdrant.collection, {
            wait: true,
            points,
        });
    }
    async removeKnowledge(knowledgeId) {
        await this.client.delete(this.config.qdrant.collection, {
            wait: true,
            filter: { must: [{ key: 'knowledgeId', match: { value: knowledgeId } }] },
        });
    }
    async removeObsoleteVersions(knowledgeId, currentVersion) {
        await this.client.delete(this.config.qdrant.collection, {
            wait: true,
            filter: {
                must: [{ key: 'knowledgeId', match: { value: knowledgeId } }],
                must_not: [{ key: 'knowledgeVersion', match: { value: currentVersion } }],
            },
        });
    }
    async search(input) {
        const points = await this.client.search(this.config.qdrant.collection, {
            vector: input.vector,
            limit: input.limit,
            score_threshold: input.minScore,
            with_payload: true,
            filter: {
                must: [
                    { key: 'businessAccountId', match: { value: input.businessAccountId } },
                    { key: 'isActive', match: { value: true } },
                ],
            },
        });
        return points.flatMap((point) => {
            const payload = point.payload;
            if (!payload ||
                typeof payload['chunkId'] !== 'string' ||
                typeof payload['knowledgeId'] !== 'string' ||
                typeof payload['title'] !== 'string' ||
                typeof payload['content'] !== 'string' ||
                typeof payload['knowledgeVersion'] !== 'number') {
                return [];
            }
            return [
                {
                    chunkId: payload['chunkId'],
                    knowledgeId: payload['knowledgeId'],
                    title: payload['title'],
                    content: payload['content'],
                    score: point.score,
                    knowledgeVersion: payload['knowledgeVersion'],
                },
            ];
        });
    }
}
//# sourceMappingURL=qdrant.js.map