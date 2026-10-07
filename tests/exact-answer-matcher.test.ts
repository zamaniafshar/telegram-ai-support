import { describe, expect, it, vi } from 'vitest';
import { ExactAnswerService } from '../src/knowledge/exact-answer-service.js';
import { silentLogger } from './helpers.js';

describe('ExactAnswerService & Matcher', () => {
  it('returns exact answer with verbatim HTML, emojis, and line breaks when score >= threshold', async () => {
    const verbatimContent = `<b>دوره جامع کنکور امسال</b> 🌱\n\nهزینه ثبت‌نام: ۶٬۰۰۰٬۰۰۰ تومان\nلینک ثبت‌نام: https://example.com/register\n\nبرای راهنمایی بیشتر پیام دهید.`;

    const prisma = {
      exactAnswer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'exact-ans-1',
          content: verbatimContent,
        }),
      },
      exactQuestion: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'exact-q-1',
          questionText: 'ثبت‌نام و شرایط کنکور امسال',
        }),
      },
    };

    const vectors = {
      searchExactQuestions: vi.fn().mockResolvedValue([
        {
          exactAnswerId: 'exact-ans-1',
          exactQuestionId: 'exact-q-1',
          questionText: 'ثبت‌نام و شرایط کنکور امسال',
          score: 0.94,
        },
      ]),
    };

    const embeddings = { embed: vi.fn() };

    const service = new ExactAnswerService(
      prisma as never,
      embeddings as never,
      vectors as never,
      silentLogger,
    );

    const match = await service.match({
      vector: [0.1, 0.2, 0.3],
      businessAccountId: 'biz-1',
      threshold: 0.88,
    });

    expect(match).not.toBeNull();
    expect(match?.exactAnswerId).toBe('exact-ans-1');
    expect(match?.exactQuestionId).toBe('exact-q-1');
    expect(match?.score).toBe(0.94);
    expect(match?.content).toBe(verbatimContent);
    expect(vectors.searchExactQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        businessAccountId: 'biz-1',
        threshold: 0.88,
      }),
    );
  });

  it('returns null when top candidate score is below threshold', async () => {
    const prisma = {
      exactAnswer: { findFirst: vi.fn() },
      exactQuestion: { findFirst: vi.fn() },
    };

    const vectors = {
      searchExactQuestions: vi.fn().mockResolvedValue([
        {
          exactAnswerId: 'exact-ans-1',
          exactQuestionId: 'exact-q-1',
          questionText: 'سؤال نامربوط',
          score: 0.75, // Below 0.88
        },
      ]),
    };

    const service = new ExactAnswerService(
      prisma as never,
      {} as never,
      vectors as never,
      silentLogger,
    );

    const match = await service.match({
      vector: [0.1, 0.2],
      businessAccountId: 'biz-1',
      threshold: 0.88,
    });

    expect(match).toBeNull();
    expect(prisma.exactAnswer.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when vector store has no matching candidates', async () => {
    const vectors = {
      searchExactQuestions: vi.fn().mockResolvedValue([]),
    };

    const service = new ExactAnswerService(
      {} as never,
      {} as never,
      vectors as never,
      silentLogger,
    );

    const match = await service.match({
      vector: [0.1, 0.2],
      businessAccountId: 'biz-1',
      threshold: 0.88,
    });

    expect(match).toBeNull();
  });

  it('returns null if answer is inactive in the database', async () => {
    const prisma = {
      exactAnswer: { findFirst: vi.fn().mockResolvedValue(null) }, // Inactive or not found
    };

    const vectors = {
      searchExactQuestions: vi.fn().mockResolvedValue([
        {
          exactAnswerId: 'inactive-ans',
          exactQuestionId: 'q-1',
          questionText: 'تست',
          score: 0.95,
        },
      ]),
    };

    const service = new ExactAnswerService(
      prisma as never,
      {} as never,
      vectors as never,
      silentLogger,
    );

    const match = await service.match({
      vector: [0.1],
      businessAccountId: 'biz-1',
      threshold: 0.88,
    });

    expect(match).toBeNull();
  });

  it('creates exact answer with question embeddings upserted to Qdrant', async () => {
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return callback({
          exactAnswer: {
            create: vi.fn().mockResolvedValue({
              id: 'new-ans',
              name: 'پاسخ کنکور',
              content: 'متن پاسخ',
              questions: [{ id: 'q-1', questionText: 'کنکور امسال', qdrantPointId: 'pt-1' }],
            }),
          },
        });
      }),
    };

    const embeddings = {
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    const vectors = {
      upsertExactQuestions: vi.fn().mockResolvedValue(undefined),
    };

    const service = new ExactAnswerService(
      prisma as never,
      embeddings as never,
      vectors as never,
      silentLogger,
    );

    const created = await service.create({
      businessAccountId: 'biz-1',
      name: 'پاسخ کنکور',
      content: 'متن پاسخ',
      questions: ['کنکور امسال'],
    });

    expect(created.id).toBe('new-ans');
    expect(embeddings.embed).toHaveBeenCalledWith(['کنکور امسال']);
    expect(vectors.upsertExactQuestions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          vector: [0.1, 0.2, 0.3],
          payload: expect.objectContaining({
            businessAccountId: 'biz-1',
            questionText: 'کنکور امسال',
          }),
        }),
      ]),
    );
  });
});
