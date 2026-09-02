export type AdminRole = 'OWNER' | 'ADMIN' | 'SUPPORT';

export interface Business {
  id: string;
  name: string;
  locale: string;
}

export interface Session {
  csrfToken: string;
  admin: { id: string; displayName: string | null; role: AdminRole };
  businesses: Business[];
  capabilities: string[];
  developmentMode?: boolean;
}

export interface Customer {
  name: string;
  username?: string | null;
  telegramUserId?: string;
  languageCode?: string | null;
}

export interface Message {
  id: string;
  senderType: string;
  direction?: string;
  text: string | null;
  sentAt: string;
  editedAt?: string | null;
  processingStatus?: string;
  processingErrorCode?: string;
}

export interface HandoffSummary {
  id: string;
  conversationId: string;
  status: string;
  reasonCode: string;
  startedAt: string;
  expiresAt: string;
  claimedBy?: string | null;
  claimed?: boolean;
  customer: Customer;
  customerName?: string;
  mode: string;
}

export interface HandoffDetail {
  id: string;
  mode: string;
  humanModeExpiresAt: string | null;
  replyWindowExpiresAt: string | null;
  customer: Customer;
  activeHandoff: (HandoffSummary & { reasonCode: string }) | null;
  history: HandoffSummary[];
  messages: Message[];
  capabilities: Record<
    'canClaim' | 'canAcknowledge' | 'canExtend' | 'canResolve' | 'canEnableAi',
    boolean
  >;
}

export interface ConversationSummary {
  id: string;
  customer: Customer;
  mode: string;
  updatedAt: string;
  replyWindowExpiresAt: string | null;
  lastMessage: Message | null;
  hasActiveHandoff: boolean;
}

export interface ConversationDetail extends Omit<
  ConversationSummary,
  'lastMessage' | 'hasActiveHandoff'
> {
  humanModeExpiresAt: string | null;
  customer: Customer & { telegramUserId: string };
  messages: Message[];
  handoffs: HandoffSummary[];
  aiDecisions: {
    id: string;
    answerable: boolean;
    confidence: number;
    createdAt: string;
    latencyMs: number;
    errorCode?: string | null;
  }[];
}

export interface KnowledgeItem {
  id: string;
  title: string;
  description: string;
  version: number;
  isActive: boolean;
  indexingStatus: string;
  updatedAt: string;
}

export interface KnowledgeDraft {
  id: string;
  knowledgeItemId?: string | null;
  title: string;
  description: string;
  revision: number;
  updatedAt: string;
}

export interface AdminAccount {
  id: string;
  telegramUserId: string;
  displayName: string | null;
  role: AdminRole;
  isActive: boolean;
  protected: boolean;
}

export interface HostHealth {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  processMemoryMb: number;
  continuousHighUsageSince: string | null;
  continuousHighUsageMinutes: number;
  isOverloaded: boolean;
  thresholdPercent: number;
  overloadDurationHours: number;
  lastCheckedAt: string | null;
}

