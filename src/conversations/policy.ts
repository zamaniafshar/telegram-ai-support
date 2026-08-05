import { ConversationMode } from '@prisma/client';

const humanRequestPatterns = [
  /\b(human|person|agent|operator|representative|real person)\b/i,
  /(?:پشتیبان|اپراتور|کارشناس|انسان|آدم واقعی|مسئول).*(?:وصل|صحبت|پاسخ|کمک)/u,
  /(?:وصل|صحبت).*(?:پشتیبان|اپراتور|کارشناس|انسان)/u,
];

export function explicitlyRequestsHuman(text: string): boolean {
  return humanRequestPatterns.some((pattern) => pattern.test(text.normalize('NFKC')));
}

export function safeGreeting(text: string): string | null {
  const normalized = text
    .normalize('NFKC')
    .trim()
    .replace(/[!؟?.،,\s]+$/u, '');
  if (/^(سلام|درود|صبح بخیر|عصر بخیر|شب بخیر)$/u.test(normalized)) {
    return 'سلام! چطور می‌توانم کمکتان کنم؟';
  }
  if (/^(hi|hello|hey|good morning|good evening)$/i.test(normalized)) {
    return 'Hello! How can I help you?';
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
