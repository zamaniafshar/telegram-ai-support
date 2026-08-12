import { ConversationMode } from '@prisma/client';

const humanRequestPatterns = [
  /\b(human|person|agent|operator|representative|real person)\b/i,
  /^(?:are you|r u) (?:an? )?(?:ai|bot|robot|chatgpt)(?: assistant)?$/i,
  /^(?:what|which) (?:ai )?model (?:are you|is this|do you use)$/i,
  /\b(?:you sound|you talk|you write|you respond) like (?:an? )?(?:ai|bot|robot)\b/i,
  /(?:poshtiban|operator|karshenas|ensan|adam vaghei).*(?:vasl|sohbat|javab|komak)/i,
  /(?:vasl|sohbat).*(?:poshtiban|operator|karshenas|ensan|adam vaghei)/i,
  /^(?:(?:vaghean|yani) )?(?:(?:to|shoma) )?(?:rob[oa]t|bot)(?:i| (?:hasti|hastid|hastin))?$/i,
  /^(?:(?:to|shoma) )?(?:ho+sh(?:e)? masno+(?:e)?[iy]|ai)(?:i| (?:hasti|hastid|hastin))?$/i,
  /^(?:(?:to|shoma) )?(?:(?:kodom|che) (?:model(?:e)? ho+sh(?:e)? masno+(?:e)?[iy]|model(?:e)? ai|ai model)|az (?:kodom|che) (?:model(?:e)? ho+sh(?:e)? masno+(?:e)?[iy]|model(?:e)? ai|ai model) estefade mi ?(?:koni|konid))(?: (?:hasti|hastid|hastin))?$/i,
  /(?:shabih(?:e)?|mesl(?:e)?) (?:ye )?(?:rob[oa]t|bot) (?:sohbat|harf|javab|pasokh) mi ?(?:koni|konid|di|did|zani|zanid)/i,
  /(?:پشتیبان|اپراتور|کارشناس|انسان|آدم واقعی|مسئول).*(?:وصل|صحبت|پاسخ|کمک)/u,
  /(?:وصل|صحبت).*(?:پشتیبان|اپراتور|کارشناس|انسان)/u,
  /^(?:(?:واقعا|یعنی) )?(?:(?:تو|شما) )?(?:ربات|بات|چت جی پی تی|chatgpt)(?:ی| (?:هستی|هستید|هستین))?$/iu,
  /^(?:(?:تو|شما) )?(?:هوش مصنوعی|ai)(?:ی| (?:هستی|هستید|هستین))?$/iu,
  /^(?:(?:تو|شما) )?(?:(?:کدوم|کدام|چه) (?:مدل هوش مصنوعی|مدل زبانی|ai model)|از (?:کدوم|کدام|چه) (?:مدل هوش مصنوعی|مدل زبانی|ai model) استفاده می ?(?:کنی|کنید))(?: (?:هستی|هستید|هستین))?$/iu,
  /(?:شبیه|مثل) (?:یک |یه )?(?:ربات|بات) (?:صحبت|حرف|جواب|پاسخ) می ?(?:کنی|کنید|دی|دید|زنی|زنید)/u,
];

function normalizePolicyText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('fa')
    .replace(/[يى]/gu, 'ی')
    .replace(/ك/gu, 'ک')
    .replace(/[ً-ٰٟـ]/gu, '')
    .replace(/[\u200c\u200d]/gu, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function explicitlyRequestsHuman(text: string): boolean {
  const normalized = normalizePolicyText(text);
  return humanRequestPatterns.some((pattern) => pattern.test(normalized));
}

const persianGreetingPart = [
  'سلا+م+(?: علیکم)?(?: (?:دوست عزیز|دوست من|ادمین|پشتیبانی))?',
  'السلام علیکم',
  'درو+د+(?: بر شما)?',
  'عرض (?:سلام|ادب)',
  '(?:وقت|روز|صبح|ظهر|عصر|شب)(?:تون| شما)? بخیر',
  'خسته نباشید?',
  'خوبی(?:ن)?',
  'خوب (?:هستی|هستید)',
  '(?:حال|احوال)(?:تون| شما)? چطوره',
  'حال(?:تون| شما)? خوبه',
  'حال شما چطور است',
  'چطوری(?:ن|د)?',
  'چه خبر',
];
const persianGreetingPattern = new RegExp(
  `^(?:${persianGreetingPart.join('|')})(?: (?:و )?(?:${persianGreetingPart.join('|')})){0,2}$`,
  'u',
);

const englishGreetingPart = [
  'hi+',
  'he+l+o+(?: there)?',
  'hey+',
  'greetings',
  'good (?:morning|afternoon|evening|day)',
  'how are (?:you|u)',
  'how is it going',
  'what s up',
  'whats up',
];
const englishGreetingPattern = new RegExp(
  `^(?:${englishGreetingPart.join('|')})(?: (?:and )?(?:${englishGreetingPart.join('|')}))?$`,
  'u',
);

const finglishGreetingPart = [
  's+a+l+a+m+',
  'doro+d+',
  'kho+bi+n?',
  'chetori+n?',
  'vaght(?:etun|ton)? bekheir',
  'sobh bekheir',
  'khaste nabashid?',
];
const finglishGreetingPattern = new RegExp(
  `^(?:${finglishGreetingPart.join('|')})(?: (?:o )?(?:${finglishGreetingPart.join('|')})){0,2}$`,
  'u',
);

export function safeGreeting(text: string): string | null {
  const normalized = normalizePolicyText(text);
  if (persianGreetingPattern.test(normalized) || finglishGreetingPattern.test(normalized)) {
    return 'سلام! چطور می‌توانم کمکتان کنم؟';
  }
  if (englishGreetingPattern.test(normalized)) {
    return 'Hello! How can I help you?';
  }
  if (/^👋+$/u.test(text.trim())) {
    return 'سلام! چطور می‌توانم کمکتان کنم؟';
  }
  return null;
}

export function canSendAiReply(input: {
  mode: ConversationMode;
  connectionEnabled: boolean;
  canReply: boolean;
  replyWindowExpiresAt: Date | null;
  now?: Date;
}): { allowed: boolean; reason?: string } {
  const now = input.now ?? new Date();
  if (input.mode !== ConversationMode.AI) return { allowed: false, reason: 'CONVERSATION_NOT_AI' };
  if (!input.connectionEnabled) return { allowed: false, reason: 'BUSINESS_CONNECTION_DISABLED' };
  if (!input.canReply) return { allowed: false, reason: 'BUSINESS_CAN_REPLY_MISSING' };
  if (!input.replyWindowExpiresAt || input.replyWindowExpiresAt <= now) {
    return { allowed: false, reason: 'TELEGRAM_REPLY_WINDOW_EXPIRED' };
  }
  return { allowed: true };
}
