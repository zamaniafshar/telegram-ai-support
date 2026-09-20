import { ConversationMode } from '@prisma/client';
export declare function explicitlyRequestsHuman(text: string): boolean;
export declare function safeGreeting(text: string): string | null;
export declare function canSendAiReply(input: {
    mode: ConversationMode;
    connectionEnabled: boolean;
    canReply: boolean;
    replyWindowExpiresAt: Date | null;
    now?: Date;
}): {
    allowed: boolean;
    reason?: string;
};
