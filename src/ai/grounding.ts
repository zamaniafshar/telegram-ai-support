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
