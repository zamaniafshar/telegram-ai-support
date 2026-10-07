import OpenAI from 'openai';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { ConversationContextMessage, QueryRewriter, QueryRewriterInput, QueryRewriterResult } from '../domain/types.js';
export declare const REWRITER_SYSTEM_PROMPT = "ROLE:\nYou are an expert Contextual Query Rewriter for a Persian customer support system.\n\nTASK:\nRewrite the customer's latest message into a clear, standalone, fully-resolved Persian search query based on the conversation history.\n\nSTRICT RULES:\n1. Resolve all anaphoric references, pronouns (e.g. \"\u0627\u06CC\u0646\", \"\u0627\u0648\u0646\", \"\u0647\u0645\u06CC\u0646\", \"\u062F\u0648\u0645\u06CC\"), and elliptical fragments (e.g. \"\u0627\u0645\u0633\u0627\u0644\", \"\u0628\u0644\u0647\", \"\u0622\u0641\u0644\u0627\u06CC\u0646\") into their concrete topic from context.\n2. If the AI previously asked a clarifying or choice question (e.g. \"\u0645\u062A\u0642\u0627\u0636\u06CC \u06A9\u0646\u06A9\u0648\u0631 \u067E\u06CC\u0634 \u0631\u0648 \u0647\u0633\u062A\u06CC\u062F \u06CC\u0627 \u0633\u0627\u0644 \u0622\u06CC\u0646\u062F\u0647\u061F\") and the user replies with a choice (e.g. \"\u0627\u0645\u0633\u0627\u0644\"), formulate the complete intent (e.g. \"\u0634\u0631\u0627\u06CC\u0637 \u0648 \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u06A9\u0646\u06A9\u0648\u0631 \u0627\u0645\u0633\u0627\u0644\").\n3. Output ONLY the rewritten Persian search query.\n4. Do NOT answer the question.\n5. Do NOT include quotes, Markdown, explanations, greetings, or pleasantries.\n6. If the customer's message is already complete and self-contained, return it unchanged.";
export declare function isPendingBotInquiry(context: ConversationContextMessage[]): boolean;
export declare function hasAnaphora(text: string): boolean;
export declare function isEllipticalFragment(text: string): boolean;
export declare function isRewriterEligible(text: string, context: ConversationContextMessage[]): boolean;
export interface QueryRewriterModel {
    rewrite(input: {
        text: string;
        context: ConversationContextMessage[];
        timeoutMs: number;
    }): Promise<string>;
}
export declare class OpenAiQueryRewriterModel implements QueryRewriterModel {
    private readonly client;
    private readonly modelName;
    constructor(config: AppConfig, client?: OpenAI);
    rewrite(input: {
        text: string;
        context: ConversationContextMessage[];
        timeoutMs: number;
    }): Promise<string>;
}
export declare class ContextualQueryRewriter implements QueryRewriter {
    private readonly config;
    private readonly logger?;
    private readonly model;
    private readonly timeoutMs;
    constructor(config: AppConfig, model?: QueryRewriterModel, logger?: Logger | undefined);
    rewriteIfEligible(input: QueryRewriterInput): Promise<QueryRewriterResult>;
}
