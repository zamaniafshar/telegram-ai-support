import { describe, expect, it } from 'vitest';
import { enforceGrounding, plainTextSupportAnswer } from '../src/ai/grounding.js';
import { preModelRoute, shouldHandoffExternalFailure } from '../src/conversations/routing.js';

describe('grounded answerability', () => {
  it('removes Markdown formatting from customer-facing answers', () => {
    expect(
      plainTextSupportAnswer(
        '## دوره‌ها\n\nدرباره **دوره جامع زیست دوازدهم**:\n\n* مدرس: `دکتر جواد رضویان`',
      ),
    ).toBe('دوره‌ها\n\nدرباره دوره جامع زیست دوازدهم:\n\n- مدرس: دکتر جواد رضویان');
  });

  it('accepts an answer only with current retrieved support IDs', () => {
    const decision = enforceGrounding(
      {
        decision: 'GROUNDED_ANSWER',
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
        decision: 'GROUNDED_ANSWER',
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
          decision: 'GROUNDED_ANSWER',
          confidence: 0.8,
          reason: 'No evidence',
          answer: 'Unsupported answer',
          supportingChunkIds: [],
        },
        new Set(),
      ).answerable,
    ).toBe(false);
  });

  it('accepts a social reply without knowledge citations', () => {
    const decision = enforceGrounding(
      {
        decision: 'SOCIAL_REPLY',
        confidence: 0.98,
        reason: 'Purely social greeting',
        answer: 'درود بر شما، بفرمایید در خدمت‌تان هستم.',
        supportingChunkIds: [],
      },
      new Set(),
    );

    expect(decision.answerable).toBe(true);
    expect(decision.answer).toBe('درود بر شما، بفرمایید در خدمت‌تان هستم.');
    expect(decision.supportingChunkIds).toEqual([]);
  });

  it('rejects a social reply that cites business knowledge', () => {
    const decision = enforceGrounding(
      {
        decision: 'SOCIAL_REPLY',
        confidence: 0.8,
        reason: 'Incorrect social classification output',
        answer: 'Hello!',
        supportingChunkIds: ['chunk-1'],
      },
      new Set(['chunk-1']),
    );

    expect(decision.answerable).toBe(false);
    expect(decision.answer).toBeNull();
  });

  it('normalizes a handoff decision to no customer answer or citations', () => {
    const decision = enforceGrounding(
      {
        decision: 'HANDOFF',
        confidence: 0.9,
        reason: 'Required fact is missing',
        answer: 'This must not be sent.',
        supportingChunkIds: ['chunk-1'],
      },
      new Set(['chunk-1']),
    );

    expect(decision.answerable).toBe(false);
    expect(decision.answer).toBeNull();
    expect(decision.supportingChunkIds).toEqual([]);
  });
});

describe('pre-model support routing', () => {
  it('hands off explicit English and Persian human requests', () => {
    expect(preModelRoute('I need a real person').kind).toBe('HANDOFF');
    expect(preModelRoute('لطفا من را به پشتیبان وصل کنید').kind).toBe('HANDOFF');
  });

  it.each([
    'رباتی؟',
    'واقعاً رباتی؟',
    'شما ربات هستید؟',
    'هوش مصنوعی هستی؟',
    'شما هوش مصنوعی هستین؟',
    'چت جی پی تی هستی؟',
    'کدوم مدل هوش مصنوعی',
    'چه مدل زبانی هستی؟',
    'از چه مدل هوش مصنوعی استفاده می‌کنی؟',
    'شبیه ربات صحبت میکنی',
    'چرا مثل ربات حرف می‌زنی؟',
    'مثل یه بات جواب می‌دید',
    'Are you a bot?',
    'Are you ChatGPT?',
    'Which AI model are you?',
    'What model are you?',
    'You sound like a robot.',
  ])('hands off bot or model identity probing: %s', (text) => {
    expect(preModelRoute(text).kind).toBe('HANDOFF');
  });

  it.each([
    'robati?',
    'vaghean robati?',
    'shoma robot hastin?',
    'hooshe masnooi hasti?',
    'kodom modele hooshe masnooi',
    'az che modele hooshe masnoei estefade mikoni?',
    'mesle robot sohbat mikoni',
    'shabihe bot javab midi',
    'lotfan be poshtiban vaslam kon',
    'mikhastam ba karshenas sohbat konam',
  ])('hands off Finglish human or bot-identity requests: %s', (text) => {
    expect(preModelRoute(text).kind).toBe('HANDOFF');
  });

  it.each([
    'ربات تلگرام برای پشتیبانی دارید؟',
    'کدام دوره هوش مصنوعی را پیشنهاد می‌کنید؟',
    'مدل برگزاری دوره چطوره؟',
    'دوره هوش مصنوعی دارید؟',
    'robot telegram baraye poshtibani darid?',
    'dore hooshe masnooi darid?',
    'model bargozari dore chie?',
  ])('does not confuse ordinary business questions with identity probing: %s', (text) => {
    expect(preModelRoute(text).kind).toBe('ASK_MODEL');
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

  it('routes greetings to the model when the safe greeting shortcut is disabled', () => {
    expect(preModelRoute('سلام', { safeGreetingEnabled: false })).toEqual({
      kind: 'ASK_MODEL',
    });
    expect(preModelRoute('Hello', { safeGreetingEnabled: false })).toEqual({
      kind: 'ASK_MODEL',
    });
    expect(preModelRoute('رباتی؟', { safeGreetingEnabled: false }).kind).toBe('HANDOFF');
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

  it('lets the model distinguish missed social openers from unsupported questions', () => {
    expect(preModelRoute('درود و عرض ادب احترام، بنده فلانی هستم و یک سوال خدمتتون داشتم')).toEqual(
      { kind: 'ASK_MODEL' },
    );
    expect(preModelRoute('قیمت دوره چقدر است؟')).toEqual({ kind: 'ASK_MODEL' });
  });

  it('retries external failures twice then hands off', () => {
    expect(shouldHandoffExternalFailure(1, 5)).toBe(false);
    expect(shouldHandoffExternalFailure(2, 5)).toBe(false);
    expect(shouldHandoffExternalFailure(3, 5)).toBe(true);
  });
});
