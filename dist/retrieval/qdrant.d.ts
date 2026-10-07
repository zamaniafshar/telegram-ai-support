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
export interface ExactVectorPoint {
    id: string;
    vector: number[];
    payload: {
        businessAccountId: string;
        exactAnswerId: string;
        exactQuestionId: string;
        questionText: string;
        isActive: boolean;
    };
}
export interface ExactQuestionMatch {
    exactAnswerId: string;
    exactQuestionId: string;
    questionText: string;
    score: number;
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
    upsertExactQuestions(points: ExactVectorPoint[]): Promise<void>;
    removeExactQuestions(pointIds: string[]): Promise<void>;
    searchExactQuestions(input: {
        vector: number[];
        businessAccountId: string;
        threshold: number;
        limit?: number;
    }): Promise<ExactQuestionMatch[]>;
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
    upsertExactQuestions(points: ExactVectorPoint[]): Promise<void>;
    removeExactQuestions(pointIds: string[]): Promise<void>;
    searchExactQuestions(input: {
        vector: number[];
        businessAccountId: string;
        threshold: number;
        limit?: number;
    }): Promise<ExactQuestionMatch[]>;
}
