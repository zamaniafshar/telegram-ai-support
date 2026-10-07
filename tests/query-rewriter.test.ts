import { describe, expect, it, vi } from 'vitest';
import {
  ContextualQueryRewriter,
  hasAnaphora,
  isEllipticalFragment,
  isPendingBotInquiry,
  isRewriterEligible,
  type QueryRewriterModel,
} from '../src/ai/query-rewriter.js';
import type { ConversationContextMessage } from '../src/domain/types.js';
import { silentLogger, testConfig } from './helpers.js';

describe('QueryRewriter Activation Guard', () => {
  it('returns false when context is empty', () => {
    expect(isRewriterEligible('امسال', [])).toBe(false);
    expect(isRewriterEligible('این دوره چطوره؟', [])).toBe(false);
  });

  it('detects pending bot inquiry ending with question mark (Persian and Latin)', () => {
    const persianContext: ConversationContextMessage[] = [
      {
        senderType: 'AI',
        text: 'متقاضی کنکور پیش رو هستید یا سال آینده؟',
        sentAt: new Date(),
      },
    ];
    expect(isPendingBotInquiry(persianContext)).toBe(true);
    expect(isRewriterEligible('امسال', persianContext)).toBe(true);

    const latinContext: ConversationContextMessage[] = [
      {
        senderType: 'AI',
        text: 'Do you want online or offline?',
        sentAt: new Date(),
      },
    ];
    expect(isPendingBotInquiry(latinContext)).toBe(true);
    expect(isRewriterEligible('online', latinContext)).toBe(true);
  });

  it('detects choice and selection prompts without question mark', () => {
    const choiceContext: ConversationContextMessage[] = [
      {
        senderType: 'AI',
        text: 'لطفا بین دوره حضوری یا آنلاین انتخاب کنید',
        sentAt: new Date(),
      },
    ];
    expect(isPendingBotInquiry(choiceContext)).toBe(true);
  });

  it('detects coreference and anaphora pronouns in user messages', () => {
    const nonInquiryContext: ConversationContextMessage[] = [
      {
        senderType: 'AI',
        text: 'پکیج‌های زیست‌شناسی جامع و نکته و تست آماده ثبت‌نام هستند.',
        sentAt: new Date(),
      },
    ];

    expect(hasAnaphora('قیمت این چقدره؟')).toBe(true);
    expect(hasAnaphora('دومی رو می‌خوام')).toBe(true);
    expect(hasAnaphora('همین دوره')).toBe(true);
    expect(hasAnaphora('پس اون چی؟')).toBe(true);
    expect(hasAnaphora('شرایطش چیه')).toBe(true);
    expect(hasAnaphora('کدومش بهتره')).toBe(true);

    expect(isRewriterEligible('دومی رو می‌خوام', nonInquiryContext)).toBe(true);
    expect(isRewriterEligible('پس اون چی', nonInquiryContext)).toBe(true);
  });

  it('does not falsely trigger anaphora on non-pronoun words (e.g. اینترنت)', () => {
    expect(hasAnaphora('اینترنت')).toBe(false);
    expect(hasAnaphora('اطلاعات اینترنت')).toBe(false);
  });

  it('detects elliptical and fragmented messages of 4 words or less', () => {
    expect(isEllipticalFragment('امسال')).toBe(true);
    expect(isEllipticalFragment('آفلاین')).toBe(true);
    expect(isEllipticalFragment('بله')).toBe(true);
    expect(isEllipticalFragment('۱۴۰۶')).toBe(true);
    expect(isEllipticalFragment('دوره زیست شناسی جامع')).toBe(true);
    expect(isEllipticalFragment('من می‌خواهم فردا برای ثبت‌نام حضوری به دفتر بیایم')).toBe(false);
  });

  it('does not activate on long standalone messages after neutral statement', () => {
    const neutralContext: ConversationContextMessage[] = [
      {
        senderType: 'AI',
        text: 'اطلاعات در سامانه ثبت شده است.',
        sentAt: new Date(),
      },
    ];
    const standaloneMessage = 'ساعت کاری دفتر مرکزی شما در روزهای پنج‌شنبه به چه شکل است';
    expect(isRewriterEligible(standaloneMessage, neutralContext)).toBe(false);
  });
});

describe('ContextualQueryRewriter fail-safe contract and execution', () => {
  it('gracefully falls back to original text on model timeout (> 1200ms) or abort', async () => {
    const slowModel: QueryRewriterModel = {
      rewrite: vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Timeout exceeded')), 100),
            ),
        ),
    };

    const rewriter = new ContextualQueryRewriter(
      testConfig({ REWRITER_TIMEOUT_MS: '50' }),
      slowModel,
      silentLogger,
    );

    const context: ConversationContextMessage[] = [
      {
        senderType: 'AI',
        text: 'کنکور امسال یا سال بعد؟',
        sentAt: new Date(),
      },
    ];

    const result = await rewriter.rewriteIfEligible({
      text: 'امسال',
      context,
    });

    expect(result.wasRewritten).toBe(false);
    expect(result.text).toBe('امسال');
  });

  it('gracefully falls back to original text on unexpected model error', async () => {
    const failingModel: QueryRewriterModel = {
      rewrite: vi.fn().mockRejectedValue(new Error('500 Internal Server Error')),
    };

    const rewriter = new ContextualQueryRewriter(testConfig(), failingModel, silentLogger);

    const context: ConversationContextMessage[] = [
      {
        senderType: 'AI',
        text: 'کدام دوره را انتخاب می‌کنید؟',
        sentAt: new Date(),
      },
    ];

    const result = await rewriter.rewriteIfEligible({
      text: 'دومی',
      context,
    });

    expect(result.wasRewritten).toBe(false);
    expect(result.text).toBe('دومی');
  });

  it('rewrites multi-turn elliptical reply into complete standalone query', async () => {
    const mockModel: QueryRewriterModel = {
      rewrite: vi.fn().mockResolvedValue('ثبت‌نام و شرایط کنکور امسال'),
    };

    const rewriter = new ContextualQueryRewriter(testConfig(), mockModel, silentLogger);

    const context: ConversationContextMessage[] = [
      {
        senderType: 'AI',
        text: 'متقاضی کنکور پیش رو هستید یا سال آینده؟',
        sentAt: new Date(),
      },
    ];

    const result = await rewriter.rewriteIfEligible({
      text: 'امسال',
      context,
    });

    expect(result.wasRewritten).toBe(true);
    expect(result.text).toBe('ثبت‌نام و شرایط کنکور امسال');
    expect(mockModel.rewrite).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'امسال',
        context,
      }),
    );
  });

  it('sets wasRewritten false when model returns identical text', async () => {
    const mockModel: QueryRewriterModel = {
      rewrite: vi.fn().mockResolvedValue('امسال'),
    };

    const rewriter = new ContextualQueryRewriter(testConfig(), mockModel, silentLogger);

    const context: ConversationContextMessage[] = [
      {
        senderType: 'AI',
        text: 'کنکور پیش رو هستید یا سال بعد؟',
        sentAt: new Date(),
      },
    ];

    const result = await rewriter.rewriteIfEligible({
      text: 'امسال',
      context,
    });

    expect(result.wasRewritten).toBe(false);
    expect(result.text).toBe('امسال');
  });
});
