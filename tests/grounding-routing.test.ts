import { describe, expect, it } from 'vitest';
import { enforceGrounding } from '../src/ai/grounding.js';
import { preModelRoute, shouldHandoffExternalFailure } from '../src/conversations/routing.js';

describe('grounded answerability', () => {
  it('accepts an answer only with current retrieved support IDs', () => {
    const decision = enforceGrounding(
      {
        answerable: true,
        confidence: 0.95,
        reason: 'Supported',
        answer: 'The approved answer.',
        supportingChunkIds: ['chunk-1'],
      },
      new Set(['chunk-1']),
    );
    expect(decision.answerable).toBe(true);
    expect(decision.answer).toBe('The approved answer.');
  });

  it('forces handoff when the model cites a chunk outside retrieval', () => {
    const decision = enforceGrounding(
      {
        answerable: true,
        confidence: 0.99,
        reason: 'Claimed support',
        answer: 'Fabricated.',
        supportingChunkIds: ['not-retrieved'],
      },
      new Set(['chunk-1']),
    );
    expect(decision.answerable).toBe(false);
    expect(decision.answer).toBeNull();
    expect(decision.supportingChunkIds).toEqual([]);
  });

  it('forces handoff when an answer has no supporting chunk', () => {
    expect(
      enforceGrounding(
        {
          answerable: true,
          confidence: 0.8,
          reason: 'No evidence',
          answer: 'Unsupported answer',
          supportingChunkIds: [],
        },
        new Set(),
      ).answerable,
    ).toBe(false);
  });
});

describe('pre-model support routing', () => {
  it('hands off explicit English and Persian human requests', () => {
    expect(preModelRoute('I need a real person').kind).toBe('HANDOFF');
    expect(preModelRoute('لطفا من را به پشتیبان وصل کنید').kind).toBe('HANDOFF');
  });

  it('uses safe localized greetings without business facts', () => {
    expect(preModelRoute('سلام')).toEqual({
      kind: 'SAFE_GREETING',
      answer: 'سلام! چطور می‌توانم کمکتان کنم؟',
    });
    expect(preModelRoute('سلام وقت بخیر')).toEqual({
      kind: 'SAFE_GREETING',
      answer: 'سلام! چطور می‌توانم کمکتان کنم؟',
    });
    expect(preModelRoute('سلام،  وقت بخیر!').kind).toBe('SAFE_GREETING');
    expect(preModelRoute('heloo').kind).toBe('SAFE_GREETING');
  });

  it.each([
    'سلام علیکم',
    'سلام و عرض ادب',
    'عرض سلام، وقتتون بخیر',
    'درود بر شما',
    'سلام، خسته نباشید',
    'سلام خوبین؟',
    'سلام، حالتون چطوره؟',
    'روزتون بخیر 🌹',
    'سلام‌و‌درود',
    'سلاااممم ادمین',
    'سلام حالتون خوبه؟',
    'خسته نباشی',
    'چه خبر؟',
    '👋',
    'Hello there!',
    'Helloooo',
    'Hi, how are you?',
    "What's up?",
    'salaam vaghtetun bekheir',
    'dorood, khobin?',
  ])('recognizes common greeting variant: %s', (text) => {
    expect(preModelRoute(text).kind).toBe('SAFE_GREETING');
  });

  it.each(['سلام، قیمت دوره چقدر است؟', 'وقت بخیر، سفارش من کجاست؟', 'Hello, what is your price?'])(
    'does not hide a business question inside a greeting: %s',
    (text) => {
      expect(preModelRoute(text).kind).toBe('ASK_MODEL');
    },
  );

  it('hands off an unsupported question after empty retrieval', () => {
    expect(preModelRoute('قیمت دوره چقدر است؟', [])).toEqual({
      kind: 'HANDOFF',
      reasonCode: 'NO_RELEVANT_KNOWLEDGE',
    });
  });

  it('retries external failures twice then hands off', () => {
    expect(shouldHandoffExternalFailure(1, 5)).toBe(false);
    expect(shouldHandoffExternalFailure(2, 5)).toBe(false);
    expect(shouldHandoffExternalFailure(3, 5)).toBe(true);
  });
});
