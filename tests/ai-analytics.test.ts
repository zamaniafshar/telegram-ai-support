import { AdminRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MiniAppManagementService } from '../src/mini-app/service.js';
import { redactTraceText, traceExpiry } from '../src/observability/trace-safety.js';
import { AuthorizationError, ResourceUnavailableError } from '../src/utils/errors.js';
import { testConfig } from './helpers.js';

function context(role: AdminRole, businessAccountId = 'business-1') {
  return {
    admin: { role },
    businessAccess: [
      { businessAccountId, businessAccount: { id: businessAccountId, isActive: true } },
    ],
  };
}

function trace() {
  return {
    id: 'trace-1',
    businessAccountId: 'business-1',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    messageBatch: [{ id: 'message-1', text: 'قیمت چقدر است؟', sentAt: '2026-08-13T10:00:00Z' }],
    conversationContext: [{ senderType: 'CUSTOMER', text: 'سلام', sentAt: '2026-08-13T09:59:00Z' }],
    rawRetrievalResults: [
      {
        rank: 1,
        chunkId: 'stale',
        title: 'قیمت قدیمی',
        content: 'قدیمی',
        score: 0.97,
        validated: false,
        rejectionReason: 'VERSION_MISMATCH',
      },
      {
        rank: 2,
        chunkId: 'current',
        title: 'قیمت',
        content: 'قیمت فعلی',
        score: 0.92,
        validated: true,
        rejectionReason: null,
      },
    ],
    validatedRetrievalResults: [{ chunkId: 'current', score: 0.92 }],
    knowledgeSentToAi: [{ chunkId: 'current', content: 'قیمت فعلی' }],
    supportingChunkIds: ['current'],
    retrievalResults: [{ chunkId: 'current', score: 0.92 }],
    decision: 'GROUNDED_ANSWER',
    answerable: true,
    confidence: 0.94,
    reason: 'پاسخ مستند است',
    answer: 'قیمت فعلی ...',
    model: 'model-1',
    promptVersion: 'prompt-1',
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    latencyMs: 500,
    retrievalLatencyMs: 80,
    totalLatencyMs: 700,
    topRetrievalScore: 0.97,
    outcome: 'SENT',
    outcomeReason: null,
    errorCode: null,
    createdAt: new Date('2026-08-13T10:00:00Z'),
    completedAt: new Date('2026-08-13T10:00:00.700Z'),
    expiresAt: new Date('2026-11-11T10:00:00Z'),
  };
}

describe('AI analytics authorization and trace projection', () => {
  it('connects raw, validated, sent, cited, decision, response, and final outcome stages', async () => {
    const prisma = { aiDecisionLog: { findFirst: vi.fn().mockResolvedValue(trace()) } };
    const service = new MiniAppManagementService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      testConfig(),
    );

    const result = await service.analyticsTraceDetails(
      context(AdminRole.ADMIN) as never,
      'business-1',
      'trace-1',
    );

    expect(result.customerMessages[0]).toMatchObject({ id: 'message-1' });
    expect(result.retrieval.raw).toHaveLength(2);
    expect(result.retrieval.validated).toHaveLength(1);
    expect(result.retrieval.sentToAi).toHaveLength(1);
    expect(result.retrieval.chunks).toMatchObject([
      { chunkId: 'stale', validated: false, sentToAi: false, citedByAi: false },
      { chunkId: 'current', validated: true, sentToAi: true, citedByAi: true },
    ]);
    expect(result.ai).toMatchObject({ decision: 'GROUNDED_ANSWER', answer: 'قیمت فعلی ...' });
    expect(result.outcome.status).toBe('SENT');
  });

  it('prevents cross-business trace access even when the trace id is known', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new MiniAppManagementService(
      { aiDecisionLog: { findFirst } } as never,
      {} as never,
      {} as never,
      {} as never,
      testConfig(),
    );

    await expect(
      service.analyticsTraceDetails(
        context(AdminRole.ADMIN) as never,
        'business-1',
        'trace-from-business-2',
      ),
    ).rejects.toBeInstanceOf(ResourceUnavailableError);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'trace-from-business-2', businessAccountId: 'business-1' },
    });
    await expect(
      service.analyticsTraceDetails(context(AdminRole.ADMIN) as never, 'business-2', 'trace-1'),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('allows support to see operational outcome while masking prompt internals', async () => {
    const service = new MiniAppManagementService(
      { aiDecisionLog: { findFirst: vi.fn().mockResolvedValue(trace()) } } as never,
      {} as never,
      {} as never,
      {} as never,
      testConfig(),
    );

    const result = await service.analyticsTraceDetails(
      context(AdminRole.SUPPORT) as never,
      'business-1',
      'trace-1',
    );

    expect(result.conversationContext).toBeNull();
    expect(result.retrieval.sentToAi).toBeNull();
    expect(result.ai.reason).toBeNull();
    expect(result.ai.promptVersion).toBeNull();
    expect(result.ai.answer).toBe('قیمت فعلی ...');
    expect(result.outcome.status).toBe('SENT');
  });

  it.each(['SENT', 'HANDOFF', 'SUPPRESSED', 'FAILED'] as const)(
    'preserves the %s final outcome without changing the trace',
    async (outcome) => {
      const stored = { ...trace(), outcome };
      const findFirst = vi.fn().mockResolvedValue(stored);
      const service = new MiniAppManagementService(
        { aiDecisionLog: { findFirst } } as never,
        {} as never,
        {} as never,
        {} as never,
        testConfig(),
      );

      const result = await service.analyticsTraceDetails(
        context(AdminRole.ADMIN) as never,
        'business-1',
        'trace-1',
      );

      expect(result.outcome.status).toBe(outcome);
      expect(findFirst).toHaveBeenCalledTimes(1);
    },
  );
});

describe('AI analytics retention and privacy', () => {
  it('bounds retention and redacts credential-like text snapshots', () => {
    const now = new Date('2026-08-13T00:00:00Z');
    expect(traceExpiry(now, 30)).toEqual(new Date('2026-09-12T00:00:00Z'));
    expect(redactTraceText('token=super-secret-value password: hunter2', 500)).toBe(
      'token=[REDACTED] password=[REDACTED]',
    );
    expect(redactTraceText('1234567890', 4)).toBe('1234');
  });
});
