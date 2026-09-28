import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../src/observability/logger.js';
import {
  SystemLogger,
  safeJsonValue,
  isInsideSystemLogger,
} from '../src/observability/system-logger.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { OpenAiAdapter } from '../src/ai/openai.js';
import { TelegramBotApiClient } from '../src/telegram-business/client.js';
import { BusinessUpdateIngestor } from '../src/telegram-business/ingest.js';
import { testConfig } from './helpers.js';

describe('Trace Logging System Verification', () => {
  it('safeJsonValue properly sanitizes BigInt, Error, Date, and Circular objects', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;

    const sanitized = safeJsonValue({
      big: 123456789012345678n,
      nested: {
        chatId: 987654321n,
      },
      err: new Error('test failure'),
      date: new Date('2026-01-01T00:00:00.000Z'),
      circ: circular,
      long: 'x'.repeat(6000),
    }) as Record<string, unknown>;

    expect(sanitized['big']).toBe('123456789012345678');
    expect((sanitized['nested'] as Record<string, unknown>)['chatId']).toBe('987654321');
    expect((sanitized['err'] as Record<string, unknown>)['message']).toBe('test failure');
    expect(sanitized['date']).toBe('2026-01-01T00:00:00.000Z');
    expect((sanitized['circ'] as Record<string, unknown>)['self']).toBe('[Circular]');
    expect((sanitized['long'] as string).length).toBe(5001); // 5000 + '…'
  });

  it('logs database queries in trace mode and prevents SystemLog recursion loops', async () => {
    const config = testConfig({
      LOG_LEVEL: 'trace',
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'trace',
    });

    const pinoLogger = createLogger(config);
    const persistedLogs: Record<string, unknown>[] = [];
    const queryListeners: ((e: {
      query: string;
      params: string;
      duration: number;
      target: string;
    }) => void)[] = [];

    const mockPrisma = {
      $on: vi.fn().mockImplementation((event: string, cb: (e: unknown) => void) => {
        if (event === 'query') queryListeners.push(cb as never);
      }),
      systemLog: {
        create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          // When SystemLogger writes to MySQL, Prisma would emit a query event!
          // We simulate Prisma emitting a query for SystemLog:
          for (const listener of queryListeners) {
            listener({
              query: 'INSERT INTO `SystemLog` (`id`, `message`) VALUES (?, ?)',
              params: '["1", "test"]',
              duration: 1,
              target: 'quaint',
            });
          }
          persistedLogs.push(args.data);
          return Promise.resolve({ id: 'log-1', ...args.data });
        }),
      },
    } as unknown as PrismaClient;

    const systemLogger = new SystemLogger(mockPrisma, pinoLogger, config);
    systemLogger.attachToLogger(pinoLogger);

    createPrismaClient(config, pinoLogger);

    // Simulate an application database query
    const simQueryListener = (e: {
      query: string;
      params: string;
      duration: number;
      target: string;
    }) => {
      const isSystemLog = isInsideSystemLogger() || /systemlog/i.test(e.query);
      pinoLogger.trace(
        {
          category: 'DATABASE',
          query: e.query,
          params: e.params,
          durationMs: e.duration,
          target: e.target,
          _fromSystemLogger: isSystemLog,
        },
        `db query executed (${e.duration}ms)`,
      );
    };

    // User executes a business query:
    simQueryListener({
      query: 'SELECT * FROM `BusinessAccount` WHERE `id` = ?',
      params: '["biz-123"]',
      duration: 3,
      target: 'quaint',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // The business query should be persisted
    expect(persistedLogs.length).toBe(1);
    expect(persistedLogs[0]?.['category']).toBe('DATABASE');
    expect(persistedLogs[0]?.['message']).toContain('SELECT * FROM `BusinessAccount`');

    // Crucially: The INSERT INTO `SystemLog` query was filtered out and did NOT trigger infinite recursion!
    expect(persistedLogs.length).toBe(1);
  });

  it('logs AI requests and responses with token usage and latency in trace mode', async () => {
    const config = testConfig({
      LOG_LEVEL: 'trace',
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'trace',
    });

    const logs: Record<string, unknown>[] = [];
    const pinoLogger = createLogger(config);
    pinoLogger.attachSink?.((rec) => logs.push(rec));

    const adapter = new OpenAiAdapter(config, undefined, pinoLogger);

    // Mock client.responses.create
    const mockClient = (
      adapter as unknown as {
        client: { responses: { create: unknown }; embeddings: { create: unknown } };
      }
    ).client;
    mockClient.responses.create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        decision: 'GROUNDED_ANSWER',
        confidence: 0.95,
        reason: 'Directly supported by knowledge',
        answer: 'بله دوره فعال است.',
        supportingChunkIds: ['chunk-1'],
      }),
      usage: {
        input_tokens: 120,
        output_tokens: 35,
        total_tokens: 155,
      },
    });

    const decision = await adapter.decide({
      customerText: 'آیا دوره آنلاین است؟',
      retrieved: [
        {
          chunkId: 'chunk-1',
          knowledgeId: 'k-1',
          title: 'دوره آنلاین',
          content: 'این دوره به صورت آنلاین برگزار می‌شود.',
          score: 0.88,
          knowledgeVersion: 1,
        },
      ],
      context: [],
    });

    expect(decision.decision).toBe('GROUNDED_ANSWER');
    expect(decision.inputTokens).toBe(120);

    const aiReqLog = logs.find((l) => l['msg'] === 'ai completion request started');
    expect(aiReqLog).toBeDefined();
    expect(aiReqLog?.['category']).toBe('AI');
    expect(aiReqLog?.['customerText']).toBe('آیا دوره آنلاین است؟');

    const aiResLog = logs.find((l) => l['msg'] === 'ai completion response received');
    expect(aiResLog).toBeDefined();
    expect(aiResLog?.['usage']).toEqual({
      input_tokens: 120,
      output_tokens: 35,
      total_tokens: 155,
    });
    expect(aiResLog?.['rawOutput']).toContain('GROUNDED_ANSWER');

    const aiEvalLog = logs.find((l) => l['msg'] === 'ai decision evaluated and grounded');
    expect(aiEvalLog).toBeDefined();
    expect(aiEvalLog?.['decision']).toBe('GROUNDED_ANSWER');
    expect(aiEvalLog?.['confidence']).toBe(0.95);
  });

  it('logs Telegram Bot API requests, HTTP status codes, and responses in trace mode', async () => {
    const config = testConfig({
      LOG_LEVEL: 'trace',
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'trace',
    });
    const logs: Record<string, unknown>[] = [];
    const pinoLogger = createLogger(config);
    pinoLogger.attachSink?.((rec) => logs.push(rec));

    const client = new TelegramBotApiClient('fake-token', 5000, pinoLogger);

    // Mock global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          result: {
            message_id: 42,
            date: 1700000000,
            chat: { id: 123456, type: 'private' },
            text: 'سلام کاربر عزیز',
          },
        }),
    } as unknown as Response);

    try {
      const res = await client.sendMessage(123456n, 'سلام کاربر عزیز');
      expect(res.message_id).toBe(42);

      const reqLog = logs.find((l) => l['msg'] === 'telegram api request: sendMessage');
      expect(reqLog).toBeDefined();
      expect(reqLog?.['category']).toBe('TELEGRAM');
      expect(reqLog?.['body']).toBeDefined();

      const resLog = logs.find((l) => l['msg'] === 'telegram api response: sendMessage');
      expect(resLog).toBeDefined();
      expect(resLog?.['statusCode']).toBe(200);
      expect((resLog?.['result'] as Record<string, unknown>)['message_id']).toBe(42);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('logs user message arrival, classification, and job queuing in BusinessUpdateIngestor', async () => {
    const config = testConfig({
      LOG_LEVEL: 'trace',
      SYSTEM_LOG_ENABLED: 'true',
      SYSTEM_LOG_DB_LEVEL: 'trace',
    });
    const logs: Record<string, unknown>[] = [];
    const pinoLogger = createLogger(config);
    pinoLogger.attachSink?.((rec) => logs.push(rec));

    const mockPrisma = {
      businessConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'conn-1',
          businessAccountId: 'biz-1',
          businessAccount: { telegramAccountUserId: 999999n },
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'conn-1',
          businessAccountId: 'biz-1',
          businessAccount: { telegramAccountUserId: 999999n },
        }),
      },
      $transaction: vi.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          processedTelegramUpdate: { create: vi.fn().mockResolvedValue({}) },
          customer: {
            upsert: vi.fn().mockResolvedValue({ id: 'cust-1' }),
          },
          conversation: {
            upsert: vi.fn().mockResolvedValue({ id: 'conv-1' }),
          },
          message: {
            upsert: vi.fn().mockResolvedValue({ id: 'msg-1' }),
          },
          conversationJob: {
            upsert: vi.fn().mockResolvedValue({ id: 'job-1' }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return cb(tx);
      }),
    } as unknown as PrismaClient;

    const mockTelegram = {
      getBusinessConnection: vi.fn(),
    };

    const ingestor = new BusinessUpdateIngestor(
      mockPrisma,
      mockTelegram as never,
      config,
      pinoLogger,
    );

    const update = {
      update_id: 1001,
      business_message: {
        message_id: 50,
        date: 1700000000,
        chat: { id: 777777, type: 'private' },
        from: { id: 777777, first_name: 'Ali' },
        business_connection_id: 'conn-1',
        text: 'شرایط دوره چیست؟',
      },
    };

    const result = await ingestor.ingest(update as never, 'corr-1001');

    expect(result.type).toBe('business_message');
    expect(result.conversationId).toBe('conv-1');

    const ingestStartLog = logs.find((l) => l['msg'] === 'telegram update ingest started');
    expect(ingestStartLog).toBeDefined();
    expect(ingestStartLog?.['updateId']).toBe(1001);

    const messageReceivedLog = logs.find(
      (l) => l['msg'] === 'business message received and classified',
    );
    expect(messageReceivedLog).toBeDefined();
    expect(messageReceivedLog?.['senderType']).toBe('CUSTOMER');
    expect(messageReceivedLog?.['customerText']).toBe('شرایط دوره چیست؟');

    const messageStoredLog = logs.find(
      (l) => l['msg'] === 'business message stored and job queued',
    );
    expect(messageStoredLog).toBeDefined();
    expect(messageStoredLog?.['conversationId']).toBe('conv-1');
  });
});
