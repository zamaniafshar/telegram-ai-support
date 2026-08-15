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
        findMany: vi.fn().mockResolvedValue([{ id: 'k1', version: 2, title: 'A' }]),
      },
      knowledgeChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'current',
            knowledgeItemId: 'k1',
            knowledgeVersion: 2,
            chunkIndex: 0,
            content: 'A',
          },
        ]),
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

  it('keeps raw Qdrant rank and MySQL rejection reasons without extra provider calls', async () => {
    const embeddings = { embed: vi.fn().mockResolvedValue([[1, 0, 0]]) };
    const vectors = {
      search: vi.fn().mockResolvedValue([
        {
          chunkId: 'stale',
          knowledgeId: 'k1',
          title: 'قدیمی',
          content: 'نسخه قدیمی',
          score: 0.96,
          knowledgeVersion: 1,
        },
        {
          chunkId: 'current',
          knowledgeId: 'k1',
          title: 'فعلی',
          content: 'نسخه فعلی',
          score: 0.91,
          knowledgeVersion: 2,
        },
      ]),
    };
    const prisma = {
      knowledgeItem: {
        findMany: vi.fn().mockResolvedValue([{ id: 'k1', version: 2, title: 'فعلی' }]),
      },
      knowledgeChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'current',
            knowledgeItemId: 'k1',
            knowledgeVersion: 2,
            chunkIndex: 0,
            content: 'نسخه فعلی',
          },
        ]),
      },
    };
    const service = new RetrievalService(
      prisma as never,
      embeddings,
      vectors as never,
      testConfig(),
    );

    const result = await service.searchDetailed('business-1', 'question');

    expect(result.raw).toMatchObject([
      { chunkId: 'stale', rank: 1, validated: false, rejectionReason: 'VERSION_MISMATCH' },
      { chunkId: 'current', rank: 2, validated: true, rejectionReason: null },
    ]);
    expect(result.validated.map((item) => item.chunkId)).toEqual(['current']);
    expect(embeddings.embed).toHaveBeenCalledTimes(1);
    expect(vectors.search).toHaveBeenCalledTimes(1);
    expect(prisma.knowledgeItem.findMany).toHaveBeenCalledTimes(1);
  });

  it('adds the rest of a matched knowledge item so complete answers see every section', async () => {
    const embeddings = { embed: vi.fn().mockResolvedValue([[1, 0, 0]]) };
    const vectors = {
      search: vi.fn().mockResolvedValue([
        {
          chunkId: 'conditions',
          knowledgeId: 'course-guide',
          title: 'راهنمای دوره',
          content: 'شرایط دوره ۱۴۰۶',
          score: 0.93,
          knowledgeVersion: 3,
        },
      ]),
    };
    const prisma = {
      knowledgeItem: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'course-guide', version: 3, title: 'راهنمای دوره' }]),
      },
      knowledgeChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'routing',
            knowledgeItemId: 'course-guide',
            knowledgeVersion: 3,
            chunkIndex: 0,
            content: 'ابتدا سال کنکور را مشخص کنید',
          },
          {
            id: 'conditions',
            knowledgeItemId: 'course-guide',
            knowledgeVersion: 3,
            chunkIndex: 1,
            content: 'شرایط دوره ۱۴۰۶',
          },
          {
            id: 'payment',
            knowledgeItemId: 'course-guide',
            knowledgeVersion: 3,
            chunkIndex: 2,
            content: 'شماره کارت ۵۰۴۱۷۲۱۲۴۰۴۲۰۴۸۰',
          },
        ]),
      },
    };
    const service = new RetrievalService(
      prisma as never,
      embeddings,
      vectors as never,
      testConfig(),
    );

    const result = await service.searchDetailed('business-1', 'شرایط دوره سال آینده');

    expect(result.raw.map((item) => item.chunkId)).toEqual(['conditions']);
    expect(result.validated.map((item) => item.chunkId)).toEqual([
      'routing',
      'conditions',
      'payment',
    ]);
    expect(result.validated.map((item) => item.content).join('\n')).toContain('۵۰۴۱۷۲۱۲۴۰۴۲۰۴۸۰');
    expect(embeddings.embed).toHaveBeenCalledTimes(1);
    expect(vectors.search).toHaveBeenCalledTimes(1);
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
