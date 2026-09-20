import { z } from 'zod';
import type { AnswerDecision } from '../domain/types.js';

export const answerDecisionSchema = z
  .object({
    decision: z.enum(['GROUNDED_ANSWER', 'SOCIAL_REPLY', 'HANDOFF']),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(2_000),
    answer: z.string().max(3_500).nullable(),
    supportingChunkIds: z.array(z.string()).max(20),
  })
  .strict();

export const LEADING_GREETINGS_PATTERN = new RegExp(
  '^(?:(?:<[^>]+>)*\\s*(?:' +
    [
      'سلام(?:\\s+علیکم|\\s+و\\s+درود|\\s+و\\s+عرض\\s+ادب|\\s+خدمت\\s+شما|\\s+دوست\\s+عزیز)?',
      'درود(?:\\s+بر\\s+شما)?',
      'عرض\\s+(?:سلام|ادب|احترام)',
      '(?:وقت|روز|صبح|عصر|شب)(?:تون|\\s+شما)?\\s+بخیر',
      'خوش\\s+(?:اومدین|آمدم?ید)',
      'hello(?:\\s+there)?',
      'hi(?:\\s+there)?',
      'hey(?:\\s+there)?',
      'good\\s+(?:morning|afternoon|evening|day)',
      'greetings',
    ].join('|') +
    ')(?![آ-یa-zA-Z0-9])[\\s،.!؟:\\-–—,🌱🌸🌹🙏💐🌿✨]*(?:<\\/[^>]+>)*[\\s،.!؟:\\-–—,🌱🌸🌹🙏💐🌿✨]*)+',
  'iu',
);

export function stripRedundantGreeting(text: string): string {
  const trimmed = text.trim();
  const stripped = trimmed.replace(LEADING_GREETINGS_PATTERN, '').trim();
  if (stripped.length > 0 && stripped !== trimmed) {
    return stripped;
  }
  return trimmed;
}

export function plainTextSupportAnswer(text: string): string {
  return text
    .replace(/^#{1,6}[ \t]+/gmu, '')
    .replace(/^[ \t]*[*+][ \t]+/gmu, '- ')
    .replace(/\*|`|~~|__/gu, '')
    .trim();
}

export function enforceGrounding(
  raw: unknown,
  retrievedChunkIds: ReadonlySet<string>,
): AnswerDecision {
  const decision = answerDecisionSchema.parse(raw);
  const allIdsValid = decision.supportingChunkIds.every((id) => retrievedChunkIds.has(id));
  const answer = decision.answer === null ? null : plainTextSupportAnswer(decision.answer);
  const hasAnswer = answer !== null && answer.length > 0;

  if (decision.decision === 'HANDOFF') {
    return {
      decision: decision.decision,
      answerable: false,
      confidence: decision.confidence,
      reason: decision.reason,
      answer: null,
      supportingChunkIds: [],
    };
  }

  if (decision.decision === 'SOCIAL_REPLY') {
    const validSocialReply = hasAnswer && decision.supportingChunkIds.length === 0;
    return {
      decision: decision.decision,
      answerable: validSocialReply,
      confidence: decision.confidence,
      reason: validSocialReply
        ? decision.reason
        : 'Social reply must contain an answer and no knowledge citations',
      answer: validSocialReply ? answer : null,
      supportingChunkIds: [],
    };
  }

  const validGroundedAnswer = hasAnswer && decision.supportingChunkIds.length > 0 && allIdsValid;
  return {
    decision: decision.decision,
    answerable: validGroundedAnswer,
    confidence: decision.confidence,
    reason: !allIdsValid
      ? 'Model selected a chunk outside current retrieval results'
      : validGroundedAnswer
        ? decision.reason
        : 'Grounded answer must contain an answer and at least one supporting chunk',
    answer: validGroundedAnswer ? answer : null,
    supportingChunkIds: allIdsValid ? decision.supportingChunkIds : [],
  };
}
