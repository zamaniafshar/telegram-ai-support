import { describe, expect, it } from 'vitest';
import { stripRedundantGreeting } from '../src/ai/grounding.js';
import { PROMPT_VERSION } from '../src/ai/openai.js';

describe('stripRedundantGreeting', () => {
  it('strips the exact screenshot case (سلام + وقتتون بخیر + emoji + newlines)', () => {
    const input = 'سلام\n\nوقتتون بخیر 🌱\n\nمتقاضی کنکور پیش رو هستید یا سال آینده؟';
    expect(stripRedundantGreeting(input)).toBe('متقاضی کنکور پیش رو هستید یا سال آینده؟');
  });

  it('strips single greeting with Persian comma', () => {
    const input = 'سلام، برای ثبت نام در دوره جامع زیست می‌توانید از لینک زیر اقدام کنید.';
    expect(stripRedundantGreeting(input)).toBe(
      'برای ثبت نام در دوره جامع زیست می‌توانید از لینک زیر اقدام کنید.',
    );
  });

  it('strips formal stacked greetings with soft emojis', () => {
    const input = 'سلام و عرض ادب، وقتتون بخیر 🌱\n\nشرایط ثبت‌نام به این شرح است:';
    expect(stripRedundantGreeting(input)).toBe('شرایط ثبت‌نام به این شرح است:');
  });

  it('strips "درود بر شما"', () => {
    const input = 'درود بر شما 🌱\n\nهزینه دوره ۶ میلیون تومان است.';
    expect(stripRedundantGreeting(input)).toBe('هزینه دوره ۶ میلیون تومان است.');
  });

  it('strips "وقت بخیر"', () => {
    const input = 'وقتتون بخیر 🌱\n\nمتقاضی کنکور پیش رو هستید یا سال آینده؟';
    expect(stripRedundantGreeting(input)).toBe('متقاضی کنکور پیش رو هستید یا سال آینده؟');
  });

  it('strips HTML-wrapped greetings', () => {
    const input = '<b>سلام</b>\n\nوقت بخیر 🌱\n\nدوره جامع شامل ویدیوها و جزوات است.';
    expect(stripRedundantGreeting(input)).toBe('دوره جامع شامل ویدیوها و جزوات است.');
  });

  it('strips English greetings when followed by content', () => {
    expect(stripRedundantGreeting('Hello! The course registration starts tomorrow.')).toBe(
      'The course registration starts tomorrow.',
    );
    expect(stripRedundantGreeting('Hi there, here are the course details:')).toBe(
      'here are the course details:',
    );
  });

  it('preserves non-greeting words starting with "سلام" (e.g. سلامت باشید / سلامتی)', () => {
    const politeAck = 'سلامت باشید 🌱 در خدمت‌تان هستیم.';
    expect(stripRedundantGreeting(politeAck)).toBe(politeAck);

    const healthText = 'سلامتی دانش‌آموزان برای ما مهم‌ترین اولویت است.';
    expect(stripRedundantGreeting(healthText)).toBe(healthText);
  });

  it('preserves greeting-only messages when stripping would result in an empty string', () => {
    const greetingOnly = 'سلام، خوش اومدین 🌱';
    expect(stripRedundantGreeting(greetingOnly)).toBe(greetingOnly);

    const simpleGreeting = 'سلام!';
    expect(stripRedundantGreeting(simpleGreeting)).toBe(simpleGreeting);
  });
});

describe('prompt version and greeting configuration', () => {
  it('has prompt version updated to reflect no repeated greetings and split formatting', () => {
    expect(PROMPT_VERSION).toBe('grounded-v12-split-and-formatting');
  });
});
