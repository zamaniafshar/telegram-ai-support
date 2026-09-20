import type { AppConfig } from '../config/env.js';
import type { AiDecisionResult, ConversationContextMessage, CurrentMessageBatchItem, RetrievalResult } from '../domain/types.js';
import type { AiProviderFailureReporter } from './nanogpt-credit.js';
export declare const PROMPT_VERSION = "grounded-v12-split-and-formatting";
export interface EmbeddingProvider {
    embed(texts: string[]): Promise<number[][]>;
}
export interface GroundedAnswerer {
    decide(input: {
        customerText: string;
        currentMessageBatch?: CurrentMessageBatchItem[];
        retrieved: RetrievalResult[];
        context: ConversationContextMessage[];
    }): Promise<AiDecisionResult>;
}
export declare class OpenAiAdapter implements EmbeddingProvider, GroundedAnswerer {
    #private;
    private readonly config;
    private readonly failureReporter?;
    private readonly client;
    constructor(config: AppConfig, failureReporter?: AiProviderFailureReporter | undefined);
    embed(texts: string[]): Promise<number[][]>;
    decide(input: {
        customerText: string;
        currentMessageBatch?: CurrentMessageBatchItem[];
        retrieved: RetrievalResult[];
        context: ConversationContextMessage[];
    }): Promise<AiDecisionResult>;
}
