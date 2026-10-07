export interface AnswerDecision {
  decision?: 'GROUNDED_ANSWER' | 'SOCIAL_REPLY' | 'HANDOFF';
  answerable: boolean;
  confidence: number;
  reason: string;
  answer: string | null;
  supportingChunkIds: string[];
}

export interface RetrievalResult {
  chunkId: string;
  knowledgeId: string;
  title: string;
  content: string;
  score: number;
  knowledgeVersion: number;
}

export interface RetrievalTraceResult extends RetrievalResult {
  rank: number;
  validated: boolean;
  rejectionReason: 'KNOWLEDGE_MISSING_OR_INACTIVE' | 'VERSION_MISMATCH' | null;
}

export interface DetailedRetrieval {
  raw: RetrievalTraceResult[];
  validated: RetrievalTraceResult[];
  latencyMs: number;
}

export interface ConversationContextMessage {
  senderType: 'CUSTOMER' | 'AI' | 'HUMAN' | 'SYSTEM';
  text: string;
  sentAt: Date;
}

export interface CurrentMessageBatchItem {
  id: string;
  text: string;
  sentAt: Date;
}

export interface AiDecisionResult extends AnswerDecision {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
}

export interface KnowledgeInput {
  businessAccountId: string;
  title: string;
  description: string;
  isActive?: boolean;
}

export interface QueryRewriterInput {
  text: string;
  context: ConversationContextMessage[];
}

export interface QueryRewriterResult {
  text: string;
  wasRewritten: boolean;
}

export interface QueryRewriter {
  rewriteIfEligible(input: QueryRewriterInput): Promise<QueryRewriterResult>;
}

export interface ExactAnswerMatchResult {
  exactAnswerId: string;
  exactQuestionId: string;
  questionText: string;
  content: string;
  score: number;
}

export interface ExactAnswerMatcher {
  match(input: {
    vector: number[];
    businessAccountId: string;
    threshold: number;
  }): Promise<ExactAnswerMatchResult | null>;
}

export type PipelineResult =
  | { type: 'EXACT_COPY_PASTE'; content: string; match?: ExactAnswerMatchResult }
  | { type: 'RAG_GENERATED'; decision: AiDecisionResult };
