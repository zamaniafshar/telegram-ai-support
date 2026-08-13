export interface AnswerDecision {
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
