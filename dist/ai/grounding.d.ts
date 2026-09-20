import { z } from 'zod';
import type { AnswerDecision } from '../domain/types.js';
export declare const answerDecisionSchema: z.ZodObject<{
    decision: z.ZodEnum<{
        HANDOFF: "HANDOFF";
        GROUNDED_ANSWER: "GROUNDED_ANSWER";
        SOCIAL_REPLY: "SOCIAL_REPLY";
    }>;
    confidence: z.ZodNumber;
    reason: z.ZodString;
    answer: z.ZodNullable<z.ZodString>;
    supportingChunkIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const LEADING_GREETINGS_PATTERN: RegExp;
export declare function stripRedundantGreeting(text: string): string;
export declare function plainTextSupportAnswer(text: string): string;
export declare function enforceGrounding(raw: unknown, retrievedChunkIds: ReadonlySet<string>): AnswerDecision;
