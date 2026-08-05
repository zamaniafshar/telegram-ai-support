import { describe, expect, it, vi } from 'vitest';
import { chunkKnowledge } from '../src/knowledge/chunker.js';
import { RetrievalService } from '../src/retrieval/service.js';
import { testConfig } from './helpers.js';

describe('knowledge chunking', () => {
  it('creates stable meaningful overlapping chunks with checksums', () => {
    const description = `${'الف '.repeat(100)}\n\n${'ب '.repeat(100)}\n\n${'ج '.repeat(100)}`;
    const first = chunkKnowledge(description, 300, 40);
    const second = chunkKnowledge(description, 300, 40);
    expect(first.length).toBeGreaterThan(1);
    expect(first).toEqual(second);
    expect(first.every((chunk) => chunk.content.length <= 300)).toBe(true);
    expect(first.every((chunk) => Boolean(chunk.checksum))).toBe(true);
  });
});

describe('retrieval filtering', () => {
  it('filters stale and inactive MySQL versions after Qdrant search', async () => {
    const embeddings = { embed: vi.fn().mockResolvedValue([[1, 0, 0]]) };
    const vectors = {
      search: vi.fn().mockResolvedValue([
        {
          chunkId: 'current',
          knowledgeId: 'k1',
          title: 'A',
          content: 'A',
          score: 0.9,
          knowledgeVersion: 2,
        },
        {
          chunkId: 'stale',
          knowledgeId: 'k1',
          title: 'A',
          content: 'old',
          score: 0.95,
          knowledgeVersion: 1,
        },
        {
          chunkId: 'inactive',
          knowledgeId: 'k2',
          title: 'B',
          content: 'B',
          score: 0.99,
          knowledgeVersion: 1,
        },
      ]),
    };
    const prisma = {
      knowledgeItem: {
        findMany: vi.fn().mockResolvedValue([{ id: 'k1', version: 2 }]),
      },
    };
    const service = new RetrievalService(
      prisma as never,
      embeddings,
      vectors as never,
      testConfig(),
    );
    const result = await service.search('business-1', 'question');
    expect(result.map((item) => item.chunkId)).toEqual(['current']);
    expect(vectors.search).toHaveBeenCalledWith(
      expect.objectContaining({ businessAccountId: 'business-1', minScore: 0.72 }),
    );
  });

  it('propagates Qdrant failures so the durable job can retry and hand off', async () => {
    const service = new RetrievalService(
      { knowledgeItem: { findMany: vi.fn() } } as never,
      { embed: vi.fn().mockResolvedValue([[1, 0, 0]]) },
      { search: vi.fn().mockRejectedValue(new Error('Qdrant timeout')) } as never,
      testConfig(),
    );
    await expect(service.search('business-1', 'question')).rejects.toThrow('Qdrant timeout');
  });
});
