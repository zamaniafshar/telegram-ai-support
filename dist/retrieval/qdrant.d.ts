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
export declare class QdrantVectorStore implements VectorStore {
    private readonly config;
    readonly client: QdrantClient;
    constructor(config: AppConfig);
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
