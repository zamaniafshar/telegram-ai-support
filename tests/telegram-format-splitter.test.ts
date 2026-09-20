import { describe, expect, it } from 'vitest';
import {
  calculateTypingDelayMs,
  splitSupportAnswer,
} from '../src/telegram-business/splitter.js';
import {
  escapeHtml,
  isTelegramEntityParseError,
  sanitizeTelegramHtml,
  stripHtml,
} from '../src/utils/telegram-format.js';

describe('splitSupportAnswer', () => {
  it('keeps short answers as a single message', () => {
    const text = 'سلام وقتتون بخیر 🌱 جزوه به‌تنهایی فروخته نمی‌شه.';
    const parts = splitSupportAnswer(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(text);
  });

  it('splits long answers along paragraph breaks', () => {
    const p1 = 'سلام وقتتون بخیر 🌱\n\nجزوات دکتر رضویان به صورت کتاب کار تدوین شدن و همراه با تدریس کلاس تکمیل می‌شن؛ به همین خاطر به‌تنهایی و بدون ثبت‌نام در دوره فروخته نمی‌شن.';
    const p2 = 'دوره‌های کلاسی شامل تدریس صفر تا صد تمام فصول بیوشیمی، حل تست و پشتیبانی مستقیم استاد هستند.';
    const p3 = 'برای راهنمایی دقیق‌تر، برای کنکور ۱۴۰۵ آماده می‌شید یا ۱۴۰۶؟ 🙏';
    const combined = `${p1}\n\n${p2}\n\n${p3}`;

    const parts = splitSupportAnswer(combined, { thresholdChars: 200, maxChunkChars: 300 });
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.length).toBeLessThanOrEqual(3);
    expect(parts.join('\n\n')).toContain('کنکور ۱۴۰۵');
  });

  it('does not exceed maxChunks', () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => `پاراگراف شماره ${i + 1} با توضیحات کافی برای تست تقسیم پیام‌ها.`);
    const combined = paragraphs.join('\n\n');

    const parts = splitSupportAnswer(combined, { thresholdChars: 100, maxChunks: 3 });
    expect(parts.length).toBeLessThanOrEqual(3);
  });

  it('handles empty or whitespace strings', () => {
    expect(splitSupportAnswer('')).toEqual([]);
    expect(splitSupportAnswer('   ')).toEqual([]);
  });

  it('splits by explicit ===SPLIT=== delimiter when present', () => {
    const text = [
      'برای کنکور ۱۴۰۶ دوره‌های جامع ارائه می‌شوند 🌱\n\n<b>دوره جامع آنلاین</b>\n• هزینه: ۶ میلیون تومان',
      '===SPLIT===',
      '<b>دوره جامع آفلاین</b>\n• هزینه: ۵.۵ میلیون تومان\n\n<b>جزوه</b>\n• دو جلدی رنگی: ۲.۵ میلیون',
      '===SPLIT===',
      '<b>اطلاعات پرداخت</b>\n• شماره کارت: <code>5041721240420480</code>',
    ].join('\n\n');

    const parts = splitSupportAnswer(text);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('دوره جامع آنلاین');
    expect(parts[1]).toContain('دوره جامع آفلاین');
    expect(parts[2]).toContain('اطلاعات پرداخت');
  });

  it('never orphans a heading at the end of a chunk without its content', () => {
    const intro = 'برای کنکور ۱۴۰۶، دوره‌های جامع بیوشیمی دکتر رضویان به‌صورت آنلاین و آفلاین ارائه می‌شوند 🌱';
    const heading = 'دوره جامع آنلاین';
    const body = '• هزینه دوره: ۶٬۹۹۹٬۰۰۰ تومان.\n• هزینه با تخفیف پرداخت نقدی مدت محدود: ۵٬۹۹۹٬۰۰۰ تومان.\n• برگزاری در بستر کافه تدریس است و قابلیت بازپخش دارد.';
    const combined = `${intro}\n\n${heading}\n\n${body}`;

    // Under maxChunkChars where intro + heading would fit (~115 chars), but body does not fit
    const parts = splitSupportAnswer(combined, { thresholdChars: 100, maxChunkChars: 130 });
    expect(parts.length).toBe(2);
    // Intro must be alone in part 0
    expect(parts[0]).toBe(intro);
    // Heading must be at the START of part 1, together with its body!
    expect(parts[1].startsWith(heading)).toBe(true);
    expect(parts[1]).toContain('هزینه دوره: ۶٬۹۹۹٬۰۰۰ تومان');
  });

  it('correctly splits long multi-section answer without orphan headings (screenshot scenario)', () => {
    const sections = [
      'برای کنکور ۱۴۰۶، دوره‌های جامع بیوشیمی دکتر رضویان به‌صورت آنلاین و آفلاین ارائه می‌شوند 🌱',
      'دوره جامع آنلاین',
      '• هزینه دوره: ۶٬۹۹۹٬۰۰۰ تومان.\n• هزینه با تخفیف پرداخت نقدی مدت محدود: ۵٬۹۹۹٬۰۰۰ تومان.\n• برگزاری در بستر کافه تدریس است و قابلیت بازپخش دارد.\n• فقط روی یک کامپیوتر با سیستم عامل ویندوز قابل استفاده است.',
      'دوره جامع آفلاین',
      '• هزینه دوره: ۵٬۵۰۰٬۰۰۰ تومان.\n• هزینه با تخفیف پرداخت نقدی مدت محدود: ۴٬۵۰۰٬۰۰۰ تومان.\n• دوره کاملاً ویدئویی است و در برنامه اسپات پلیر ارائه می‌شود.\n• لایسنس فقط روی یک دستگاه فعال می‌شود، گوشی یا کامپیوتر.\n• نسخه تحت وب ندارد.',
      'جزوه',
      '• جزوه دو جلدی رنگی: ۲٬۵۰۰٬۰۰۰ تومان.\n• جزوه دو جلدی سیاه و سفید: ۲٬۰۰۰٬۰۰۰ تومان.\n• جزوه چاپی است و با تیپاکس به‌صورت پس کرایه ارسال می‌شود.',
      'شرایط مشترک',
      '• هر دو دوره گروه پشتیبانی رفع اشکال دارند، دو روز در هفته.\n• پایان هر فصل آزمون کلاسی برگزار می‌شود.\n• تدریس بر اساس آخرین منابع اعلامی انجام می‌شود.\n• دسترسی تا روز کنکور کارشناسی ارشد ۱۴۰۶ برقرار است و پس از آن لایسنس منقضی می‌شود.\n• هزینه دوره‌های نکته و تست و همایش جداگانه است.',
      'پرداخت و ثبت نام',
      '• شماره کارت: 5041721240420480\n• بانک: قرض الحسنه رسالت\n• به نام: حماد رضویان',
    ];
    const fullText = sections.join('\n\n');

    const parts = splitSupportAnswer(fullText, { thresholdChars: 400, maxChunkChars: 450, maxChunks: 5 });
    expect(parts.length).toBeGreaterThanOrEqual(2);

    const headings = ['دوره جامع آنلاین', 'دوره جامع آفلاین', 'جزوه', 'شرایط مشترک', 'پرداخت و ثبت نام'];

    // Verify NO part ends with any heading
    for (const part of parts) {
      for (const h of headings) {
        expect(part.trim().endsWith(h)).toBe(false);
      }
    }
  });
});

describe('calculateTypingDelayMs', () => {
  it('respects min and max bounds', () => {
    expect(calculateTypingDelayMs(5)).toBe(1_230);
    expect(calculateTypingDelayMs(100)).toBe(1_800);
    expect(calculateTypingDelayMs(1_000)).toBe(2_800);
  });
});

describe('sanitizeTelegramHtml', () => {
  it('preserves valid Telegram HTML tags', () => {
    const input = 'سلام! <b>دوره آنلاین</b> و <code>5041721240420480</code> در دسترس است.';
    const result = sanitizeTelegramHtml(input);
    expect(result).toBe(input);
  });

  it('closes unclosed tags safely', () => {
    const input = '<b>این یک متن بولد است بدون بستن تگ';
    const result = sanitizeTelegramHtml(input);
    expect(result).toBe('<b>این یک متن بولد است بدون بستن تگ</b>');
  });

  it('escapes rogue brackets and ampersands', () => {
    const input = 'قیمت < 5000 و A & B است.';
    const result = sanitizeTelegramHtml(input);
    expect(result).toContain('&lt;');
    expect(result).toContain('&amp;');
  });

  it('converts markdown bold and links to HTML', () => {
    const input = 'ثبت‌نام در **دوره جامع** از طریق [کانال](https://t.me/DrRazaviyan)';
    const result = sanitizeTelegramHtml(input);
    expect(result).toContain('<b>دوره جامع</b>');
    expect(result).toContain('<a href="https://t.me/DrRazaviyan">کانال</a>');
  });

  it('removes unsupported tags like paragraph or replaces br with newline', () => {
    const input = '<p>پاراگراف اول</p><br><p>پاراگراف دوم</p>';
    const result = sanitizeTelegramHtml(input);
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<br>');
    expect(result).toContain('پاراگراف اول');
    expect(result).toContain('پاراگراف دوم');
  });
});

describe('stripHtml', () => {
  it('strips all HTML tags and unescapes entities', () => {
    const input = '<b>سلام</b> &amp; <i>درود</i><br><a href="https://example.com">لینک</a>';
    expect(stripHtml(input)).toBe('سلام & درود\nلینک');
  });
});

describe('isTelegramEntityParseError', () => {
  it('identifies entity parse errors correctly', () => {
    expect(isTelegramEntityParseError(new Error("Bad Request: can't parse entities"))).toBe(true);
    expect(isTelegramEntityParseError({ message: 'Telegram API 400: ENTITY_PARSE_FAILED' })).toBe(true);
    expect(isTelegramEntityParseError(new Error('Network timeout'))).toBe(false);
  });
});
