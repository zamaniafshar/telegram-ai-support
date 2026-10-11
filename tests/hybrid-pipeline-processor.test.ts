import { describe, expect, it, vi } from 'vitest';
import { ConversationMode, MessageProcessingStatus, SenderType } from '@prisma/client';
import { ConversationProcessor } from '../src/conversations/processor.js';
import type { ExactAnswerMatcher, QueryRewriter } from '../src/domain/types.js';
import { silentLogger, testConfig } from './helpers.js';

interface SetupOptions {
  history?: { text: string; senderType: SenderType }[];
  incomingText: string;
  rewriterResult?: { text: string; wasRewritten: boolean };
  exactMatchResult?: {
    exactAnswerId: string;
    exactQuestionId: string;
    questionText: string;
    content: string;
    score: number;
  } | null;
  ragAnswer?: string;
}

function createPipelineHarness(options: SetupOptions) {
  const now = new Date();

  const historyMessages = (options.history ?? []).map((item, index) => ({
    id: `hist-${index + 1}`,
    conversationId: 'conv-1',
    text: item.text,
    senderType: item.senderType,
    sentAt: new Date(now.getTime() - (10 - index) * 1_000),
    deletedAt: null,
  }));

  const incomingMessage = {
    id: 'msg-incoming-1',
    conversationId: 'conv-1',
    text: options.incomingText,
    senderType: SenderType.CUSTOMER,
    sentAt: now,
    deletedAt: null,
  };

  const job = {
    id: 'job-1',
    conversationId: 'conv-1',
    messageId: incomingMessage.id,
    message: incomingMessage,
    status: MessageProcessingStatus.PENDING,
    processAfter: now,
    attempts: 0,
    maxAttempts: 5,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    waitingReason: null,
    processingBatchId: null,
    createdAt: now,
    updatedAt: now,
  };

  const conversation = {
    id: 'conv-1',
    businessAccountId: 'biz-1',
    mode: ConversationMode.AI,
    telegramReplyWindowExpiresAt: new Date(now.getTime() + 3_600_000),
    businessAccount: {
      id: 'biz-1',
      aiSettings: null,
      aiHourlyWindowStartedAt: null,
      aiHourlyRequestCount: 0,
      aiDailyWindowStartedAt: null,
      aiDailyRequestCount: 0,
      aiBlockedUntil: null,
    },
    customer: {
      id: 'cust-1',
      aiHourlyWindowStartedAt: null,
      aiHourlyRequestCount: 0,
      aiDailyWindowStartedAt: null,
      aiDailyRequestCount: 0,
      aiBlockedUntil: null,
    },
    handoffs: [],
    messages: [...historyMessages, incomingMessage],
  };

  const prisma = {
    customer: { update: vi.fn().mockResolvedValue({}) },
    businessAccount: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    conversationJob: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([{ conversationId: 'conv-1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([job]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    conversation: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([{ id: 'conv-1', businessAccountId: 'biz-1' }]),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValueOnce(conversation)
        .mockResolvedValue({ ...conversation, messages: [] }),
    },
    message: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    aiDecisionLog: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const rewriter: QueryRewriter = {
    rewriteIfEligible: vi.fn().mockResolvedValue(
      options.rewriterResult ?? {
        text: options.incomingText,
        wasRewritten: false,
      },
    ),
  };

  const exactMatcher: ExactAnswerMatcher = {
    match: vi.fn().mockResolvedValue(options.exactMatchResult ?? null),
  };

  const embeddings = {
    embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  };

  const retrieval = {
    searchDetailed: vi.fn().mockResolvedValue({
      raw: [],
      validated: [],
      latencyMs: 5,
    }),
    search: vi.fn().mockResolvedValue([]),
  };

  const answerer = {
    decide: vi.fn().mockResolvedValue({
      decision: 'GROUNDED_ANSWER',
      answerable: true,
      confidence: 0.9,
      reason: 'RAG synthesis grounded in chunks',
      answer: options.ragAnswer ?? 'پاسخ ترکیبی با RAG',
      supportingChunkIds: ['chunk-1'],
      model: 'gpt-4o',
      latencyMs: 120,
    }),
  };

  const messenger = {
    sendAiAnswer: vi.fn().mockResolvedValue(undefined),
    sendHandoffAcknowledgement: vi.fn(),
    whileTyping: vi.fn(async (_convId: string, op: () => Promise<unknown>) => op()),
  };

  const availability = {
    businessSettings: vi.fn().mockResolvedValue({
      enabled: true,
      timezone: 'Asia/Tehran',
      weeklySchedule: [],
      outsideHoursPolicy: 'QUEUE',
      manualShutdownPolicy: 'QUEUE',
      backlogMaxAgeHours: 24,
    }),
    check: vi.fn().mockResolvedValue({
      available: true,
      reason: 'AVAILABLE',
      nextTransitionAt: null,
    }),
  };

  const processor = new ConversationProcessor(
    prisma as never,
    retrieval as never,
    answerer as never,
    { activate: vi.fn() } as never,
    messenger as never,
    {} as never,
    availability as never,
    testConfig({ SAFE_GREETING_ENABLED: 'false', WORKER_POLL_INTERVAL_MS: '100' }),
    silentLogger,
    rewriter,
    exactMatcher,
    embeddings as never,
  );

  return {
    processor,
    prisma,
    rewriter,
    exactMatcher,
    embeddings,
    retrieval,
    answerer,
    messenger,
  };
}

describe('Hybrid Deterministic FAQ & Contextual Rewriting Pipeline', () => {
  it('resolves multi-turn dependency ("امسال" after "امسال یا سال بعد؟"), matches exact FAQ, and bypasses LLM generator entirely', async () => {
    const verbatimFaqAnswer = `<b>دوره جامع کنکور پیش رو (امسال)</b> 🌱\n\nهزینه: ۵٬۵۰۰٬۰۰۰ تومان\nلینک ثبت‌نام: https://example.com/konkoor\nموفق باشید!`;

    const harness = createPipelineHarness({
      history: [
        {
          text: 'متقاضی کنکور پیش رو هستید یا سال آینده؟',
          senderType: SenderType.AI,
        },
      ],
      incomingText: 'امسال',
      rewriterResult: {
        text: 'ثبت‌نام کنکور امسال',
        wasRewritten: true,
      },
      exactMatchResult: {
        exactAnswerId: 'exact-ans-101',
        exactQuestionId: 'exact-q-202',
        questionText: 'ثبت‌نام کنکور امسال',
        content: verbatimFaqAnswer,
        score: 0.94,
      },
    });

    const processedCount = await harness.processor.runBatch('worker-1');
    expect(processedCount).toBe(1);

    // 1. Rewriter was invoked with context
    expect(harness.rewriter.rewriteIfEligible).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'امسال',
        context: expect.arrayContaining([
          expect.objectContaining({
            text: 'متقاضی کنکور پیش رو هستید یا سال آینده؟',
            senderType: 'AI',
          }),
        ]),
      }),
    );

    // 2. Embedding was generated for the rewritten search query
    expect(harness.embeddings.embed).toHaveBeenCalledWith(['ثبت‌نام کنکور امسال']);

    // 3. ExactMatcher was queried
    expect(harness.exactMatcher.match).toHaveBeenCalledWith(
      expect.objectContaining({
        businessAccountId: 'biz-1',
        threshold: 0.6,
      }),
    );

    // 4. Zero LLM Generation: GroundedAnswerer.decide MUST NOT be called!
    expect(harness.answerer.decide).not.toHaveBeenCalled();

    // 5. Verbatim response sent to user
    expect(harness.messenger.sendAiAnswer).toHaveBeenCalledWith(
      'conv-1',
      verbatimFaqAnswer,
      'msg-incoming-1',
      { isCopyPaste: true },
    );

    // 6. Trace log recorded DECISION: COPY_PASTE_EXACT_MATCH and exact match metadata
    expect(harness.prisma.aiDecisionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { messageId: 'msg-incoming-1' },
        data: expect.objectContaining({
          decision: 'COPY_PASTE_EXACT_MATCH',
          answerable: true,
          answer: verbatimFaqAnswer,
          matchedExactQuestionId: 'exact-q-202',
          exactMatchScore: 0.94,
        }),
      }),
    );
  });

  it('falls back to standard chunk-based RAG when exact match score is below threshold', async () => {
    const harness = createPipelineHarness({
      history: [
        {
          text: 'سلام، چطور می‌تونم کمکتون کنم؟',
          senderType: SenderType.AI,
        },
      ],
      incomingText: 'شرایط اقساطی پرداخت هزینه دوره‌ها به چه صورتی است؟',
      rewriterResult: {
        text: 'شرایط اقساطی پرداخت هزینه دوره‌ها به چه صورتی است؟',
        wasRewritten: false,
      },
      exactMatchResult: null, // No exact match meets the 0.88 threshold
      ragAnswer: 'پرداخت اقساطی در دو مرحله امکان‌پذیر است.',
    });

    const processedCount = await harness.processor.runBatch('worker-1');
    expect(processedCount).toBe(1);

    // 1. Exact match attempted
    expect(harness.exactMatcher.match).toHaveBeenCalled();

    // 2. Fallback to standard RAG retrieval and answerer
    expect(harness.retrieval.searchDetailed).toHaveBeenCalledWith(
      'biz-1',
      'شرایط اقساطی پرداخت هزینه دوره‌ها به چه صورتی است؟',
    );
    expect(harness.answerer.decide).toHaveBeenCalled();

    // 3. Messenger dispatches the RAG answer
    expect(harness.messenger.sendAiAnswer).toHaveBeenCalledWith(
      'conv-1',
      'پرداخت اقساطی در دو مرحله امکان‌پذیر است.',
      'msg-incoming-1',
      { isCopyPaste: false },
    );
  });
});
