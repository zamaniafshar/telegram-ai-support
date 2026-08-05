import { z } from 'zod';
import type { AnswerDecision } from '../domain/types.js';

export const answerDecisionSchema = z.object({
  answerable: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(2_000),
  answer: z.string().max(3_500).nullable(),
  supportingChunkIds: z.array(z.string()).max(20),
});

export function enforceGrounding(
  raw: unknown,
  retrievedChunkIds: ReadonlySet<string>,
): AnswerDecision {
  const decision = answerDecisionSchema.parse(raw);
  const allIdsValid = decision.supportingChunkIds.every((id) => retrievedChunkIds.has(id));
  const validAnswer =
    decision.answerable &&
    decision.answer !== null &&
    decision.answer.trim().length > 0 &&
    decision.supportingChunkIds.length > 0 &&
    allIdsValid;
  return {
    ...decision,
    answerable: validAnswer,
    answer: validAnswer ? decision.answer : null,
    reason: allIdsValid
      ? decision.reason
      : 'Model selected a chunk outside current retrieval results',
    supportingChunkIds: allIdsValid ? decision.supportingChunkIds : [],
  };
}
