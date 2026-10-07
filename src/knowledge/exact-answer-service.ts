import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { EmbeddingProvider } from '../ai/openai.js';
import type { ExactAnswerMatcher, ExactAnswerMatchResult } from '../domain/types.js';
import type { ExactVectorPoint, VectorStore } from '../retrieval/qdrant.js';
import { deterministicUuid, newId } from '../utils/ids.js';

export interface CreateExactAnswerInput {
  businessAccountId: string;
  name: string;
  content: string;
  questions: string[];
  adminId?: string | undefined;
  isActive?: boolean | undefined;
}

export interface UpdateExactAnswerInput {
  name?: string | undefined;
  content?: string | undefined;
  isActive?: boolean | undefined;
  questions?: string[] | undefined;
  adminId?: string | undefined;
}

export class ExactAnswerService implements ExactAnswerMatcher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectors: VectorStore,
    private readonly logger?: Logger,
  ) {}

  async match(input: {
    vector: number[];
    businessAccountId: string;
    threshold: number;
  }): Promise<ExactAnswerMatchResult | null> {
    const started = Date.now();
    this.logger?.trace(
      {
        category: 'RETRIEVAL',
        businessAccountId: input.businessAccountId,
        threshold: input.threshold,
      },
      'matching exact answer candidates in vector store',
    );

    const candidates = await this.vectors.searchExactQuestions({
      vector: input.vector,
      businessAccountId: input.businessAccountId,
      threshold: input.threshold,
      limit: 1,
    });

    const topCandidate = candidates[0];
    if (!topCandidate) {
      this.logger?.trace(
        {
          category: 'RETRIEVAL',
          businessAccountId: input.businessAccountId,
          latencyMs: Date.now() - started,
        },
        'exact answer match: no candidates reached threshold',
      );
      return null;
    }

    if (topCandidate.score < input.threshold) {
      return null;
    }

    const answer = await this.prisma.exactAnswer.findFirst({
      where: {
        id: topCandidate.exactAnswerId,
        businessAccountId: input.businessAccountId,
        isActive: true,
      },
      select: { id: true, content: true },
    });

    if (!answer) {
      this.logger?.warn(
        {
          exactAnswerId: topCandidate.exactAnswerId,
          businessAccountId: input.businessAccountId,
        },
        'exact match candidate points to missing or inactive answer in database',
      );
      return null;
    }

    const question = await this.prisma.exactQuestion.findFirst({
      where: {
        id: topCandidate.exactQuestionId,
        exactAnswerId: answer.id,
        isActive: true,
      },
      select: { id: true, questionText: true },
    });

    if (!question) {
      this.logger?.warn(
        {
          exactQuestionId: topCandidate.exactQuestionId,
          exactAnswerId: answer.id,
        },
        'exact match candidate points to missing or inactive question in database',
      );
      return null;
    }

    this.logger?.info(
      {
        exactAnswerId: answer.id,
        exactQuestionId: question.id,
        score: topCandidate.score,
        questionText: question.questionText,
        latencyMs: Date.now() - started,
      },
      'exact answer matched with high confidence',
    );

    return {
      exactAnswerId: answer.id,
      exactQuestionId: question.id,
      questionText: question.questionText,
      content: answer.content,
      score: topCandidate.score,
    };
  }

  async create(input: CreateExactAnswerInput) {
    const cleanQuestions = input.questions.map((q) => q.trim()).filter((q) => q.length > 0);

    const answerId = newId();
    const questionRecords = cleanQuestions.map((questionText) => {
      const questionId = newId();
      return {
        id: questionId,
        questionText,
        qdrantPointId: deterministicUuid(`exact:${answerId}:${questionId}`),
        isActive: input.isActive ?? true,
      };
    });

    let vectorPoints: ExactVectorPoint[] = [];
    if (questionRecords.length > 0) {
      const embeddings = await this.embeddings.embed(questionRecords.map((q) => q.questionText));
      vectorPoints = questionRecords.map((q, index) => ({
        id: q.qdrantPointId,
        vector: embeddings[index] ?? [],
        payload: {
          businessAccountId: input.businessAccountId,
          exactAnswerId: answerId,
          exactQuestionId: q.id,
          questionText: q.questionText,
          isActive: q.isActive,
        },
      }));
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const answer = await tx.exactAnswer.create({
        data: {
          id: answerId,
          businessAccountId: input.businessAccountId,
          name: input.name,
          content: input.content,
          isActive: input.isActive ?? true,
          createdByAdminId: input.adminId ?? null,
          updatedByAdminId: input.adminId ?? null,
          questions: {
            create: questionRecords.map((q) => ({
              id: q.id,
              questionText: q.questionText,
              qdrantPointId: q.qdrantPointId,
              isActive: q.isActive,
            })),
          },
        },
        include: { questions: true },
      });
      return answer;
    });

    if (vectorPoints.length > 0) {
      await this.vectors.upsertExactQuestions(vectorPoints);
    }

    return created;
  }

  async update(id: string, businessAccountId: string, input: UpdateExactAnswerInput) {
    const existing = await this.prisma.exactAnswer.findFirstOrThrow({
      where: { id, businessAccountId },
      include: { questions: true },
    });

    if (input.questions !== undefined) {
      const cleanQuestions = input.questions.map((q) => q.trim()).filter((q) => q.length > 0);

      // Remove existing question points from Qdrant
      const existingPointIds = existing.questions.map((q) => q.qdrantPointId);
      if (existingPointIds.length > 0) {
        await this.vectors.removeExactQuestions(existingPointIds);
      }

      const newQuestionRecords = cleanQuestions.map((questionText) => {
        const questionId = newId();
        return {
          id: questionId,
          questionText,
          qdrantPointId: deterministicUuid(`exact:${id}:${questionId}`),
          isActive: input.isActive ?? existing.isActive,
        };
      });

      let vectorPoints: ExactVectorPoint[] = [];
      if (newQuestionRecords.length > 0) {
        const embeddings = await this.embeddings.embed(
          newQuestionRecords.map((q) => q.questionText),
        );
        vectorPoints = newQuestionRecords.map((q, index) => ({
          id: q.qdrantPointId,
          vector: embeddings[index] ?? [],
          payload: {
            businessAccountId,
            exactAnswerId: id,
            exactQuestionId: q.id,
            questionText: q.questionText,
            isActive: q.isActive,
          },
        }));
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.exactQuestion.deleteMany({ where: { exactAnswerId: id } });
        return tx.exactAnswer.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.content !== undefined ? { content: input.content } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            ...(input.adminId !== undefined ? { updatedByAdminId: input.adminId } : {}),
            questions: {
              create: newQuestionRecords.map((q) => ({
                id: q.id,
                questionText: q.questionText,
                qdrantPointId: q.qdrantPointId,
                isActive: q.isActive,
              })),
            },
          },
          include: { questions: true },
        });
      });

      if (vectorPoints.length > 0) {
        await this.vectors.upsertExactQuestions(vectorPoints);
      }

      return updated;
    }

    // Only updating attributes without changing questions
    const updated = await this.prisma.exactAnswer.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.adminId !== undefined ? { updatedByAdminId: input.adminId } : {}),
      },
      include: { questions: true },
    });

    // If isActive changed, update question vector payload
    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      await this.prisma.exactQuestion.updateMany({
        where: { exactAnswerId: id },
        data: { isActive: input.isActive },
      });
      const embeddings = await this.embeddings.embed(existing.questions.map((q) => q.questionText));
      const points: ExactVectorPoint[] = existing.questions.map((q, index) => ({
        id: q.qdrantPointId,
        vector: embeddings[index] ?? [],
        payload: {
          businessAccountId,
          exactAnswerId: id,
          exactQuestionId: q.id,
          questionText: q.questionText,
          isActive: input.isActive ?? true,
        },
      }));
      await this.vectors.upsertExactQuestions(points);
    }

    return updated;
  }

  async delete(id: string, businessAccountId: string): Promise<void> {
    const existing = await this.prisma.exactAnswer.findFirstOrThrow({
      where: { id, businessAccountId },
      include: { questions: true },
    });

    const pointIds = existing.questions.map((q) => q.qdrantPointId);
    if (pointIds.length > 0) {
      await this.vectors.removeExactQuestions(pointIds);
    }

    await this.prisma.exactAnswer.delete({ where: { id } });
  }

  async reindex(businessAccountId?: string): Promise<number> {
    const answers = await this.prisma.exactAnswer.findMany({
      where: {
        ...(businessAccountId ? { businessAccountId } : {}),
        isActive: true,
      },
      include: {
        questions: { where: { isActive: true } },
      },
    });

    const allQuestions = answers.flatMap((answer) =>
      answer.questions.map((q) => ({
        ...q,
        businessAccountId: answer.businessAccountId,
      })),
    );

    if (allQuestions.length === 0) return 0;

    const texts = allQuestions.map((q) => q.questionText);
    const embeddings = await this.embeddings.embed(texts);

    const points: ExactVectorPoint[] = allQuestions.map((q, index) => ({
      id: q.qdrantPointId,
      vector: embeddings[index] ?? [],
      payload: {
        businessAccountId: q.businessAccountId,
        exactAnswerId: q.exactAnswerId,
        exactQuestionId: q.id,
        questionText: q.questionText,
        isActive: q.isActive,
      },
    }));

    await this.vectors.upsertExactQuestions(points);
    return points.length;
  }

  async list(businessAccountId: string, query?: string) {
    return this.prisma.exactAnswer.findMany({
      where: {
        businessAccountId,
        ...(query
          ? {
              OR: [
                { name: { contains: query } },
                { content: { contains: query } },
                { questions: { some: { questionText: { contains: query } } } },
              ],
            }
          : {}),
      },
      include: {
        questions: {
          select: { id: true, questionText: true, isActive: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(id: string, businessAccountId: string) {
    return this.prisma.exactAnswer.findFirst({
      where: { id, businessAccountId },
      include: {
        questions: {
          select: { id: true, questionText: true, isActive: true, createdAt: true },
        },
        createdByAdmin: {
          select: { id: true, displayName: true },
        },
        updatedByAdmin: {
          select: { id: true, displayName: true },
        },
      },
    });
  }
}
