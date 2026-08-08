import { QdrantClient } from '@qdrant/js-client-rest';
import type { AppConfig } from '../config/env.js';
import type { RetrievalResult } from '../domain/types.js';

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: {
    businessAccountId: string;
    knowledgeId: string;
    chunkId: string;
    chunkIndex: number;
    knowledgeVersion: number;
    title: string;
    content: string;
    isActive: boolean;
    checksum: string;
  };
}

export interface VectorStore {
  ensureCollection(dimensions: number): Promise<void>;
  recreateCollection(dimensions: number): Promise<void>;
  healthy(): Promise<boolean>;
  upsert(points: VectorPoint[]): Promise<void>;
  removeKnowledge(knowledgeId: string): Promise<void>;
  removeObsoleteVersions(knowledgeId: string, currentVersion: number): Promise<void>;
  search(input: {
    vector: number[];
    businessAccountId: string;
    minScore: number;
    limit: number;
  }): Promise<RetrievalResult[]>;
}

export class QdrantVectorStore implements VectorStore {
  readonly client: QdrantClient;

  constructor(private readonly config: AppConfig) {
    this.client = new QdrantClient({
      url: config.qdrant.url,
      ...(config.qdrant.apiKey ? { apiKey: config.qdrant.apiKey } : {}),
      timeout: config.qdrant.timeoutMs,
      checkCompatibility: false,
    });
  }

  async ensureCollection(dimensions: number): Promise<void> {
    const collections = await this.client.getCollections();
    if (!collections.collections.some((item) => item.name === this.config.qdrant.collection)) {
      await this.client.createCollection(this.config.qdrant.collection, {
        vectors: { size: dimensions, distance: 'Cosine' },
        on_disk_payload: true,
      });
    } else {
      const info = await this.client.getCollection(this.config.qdrant.collection);
      const vectors = info.config.params.vectors;
      const actualSize =
        vectors && 'size' in vectors && typeof vectors.size === 'number' ? vectors.size : undefined;
      if (actualSize !== undefined && actualSize !== dimensions) {
        throw new Error(
          `Qdrant collection dimension ${actualSize} does not match embedding dimension ${dimensions}`,
        );
      }
    }

    const payloadIndexes = [
      { fieldName: 'businessAccountId', schema: 'keyword' },
      { fieldName: 'knowledgeId', schema: 'keyword' },
      { fieldName: 'chunkId', schema: 'keyword' },
      { fieldName: 'isActive', schema: 'bool' },
      { fieldName: 'knowledgeVersion', schema: 'integer' },
    ] as const;
    for (const { fieldName, schema } of payloadIndexes) {
      await this.client
        .createPayloadIndex(this.config.qdrant.collection, {
          field_name: fieldName,
          field_schema: schema,
          wait: true,
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error) || !/already exists/i.test(error.message)) throw error;
        });
    }
  }

  async recreateCollection(dimensions: number): Promise<void> {
    const collections = await this.client.getCollections();
    if (collections.collections.some((item) => item.name === this.config.qdrant.collection)) {
      await this.client.deleteCollection(this.config.qdrant.collection);
    }
    await this.ensureCollection(dimensions);
  }

  async healthy(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.client.upsert(this.config.qdrant.collection, {
      wait: true,
      points,
    });
  }

  async removeKnowledge(knowledgeId: string): Promise<void> {
    await this.client.delete(this.config.qdrant.collection, {
      wait: true,
      filter: { must: [{ key: 'knowledgeId', match: { value: knowledgeId } }] },
    });
  }

  async removeObsoleteVersions(knowledgeId: string, currentVersion: number): Promise<void> {
    await this.client.delete(this.config.qdrant.collection, {
      wait: true,
      filter: {
        must: [{ key: 'knowledgeId', match: { value: knowledgeId } }],
        must_not: [{ key: 'knowledgeVersion', match: { value: currentVersion } }],
      },
    });
  }

  async search(input: {
    vector: number[];
    businessAccountId: string;
    minScore: number;
    limit: number;
  }): Promise<RetrievalResult[]> {
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
      if (
        !payload ||
        typeof payload['chunkId'] !== 'string' ||
        typeof payload['knowledgeId'] !== 'string' ||
        typeof payload['title'] !== 'string' ||
        typeof payload['content'] !== 'string' ||
        typeof payload['knowledgeVersion'] !== 'number'
      ) {
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
