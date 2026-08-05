import {
  ConversationMode,
  MessageDirection,
  MessageProcessingStatus,
  SenderType,
  type PrismaClient,
} from '@prisma/client';
import type { Logger } from 'pino';
import type { TelegramApi } from './client.js';
import { AppError } from '../utils/errors.js';
import { newId, telegramId } from '../utils/ids.js';

export class BusinessMessenger {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly telegram: TelegramApi,
    private readonly logger: Logger,
  ) {}

  async sendAiAnswer(conversationId: string, text: string, sourceMessageId: string): Promise<void> {
    await this.#send(conversationId, text, SenderType.AI, false, sourceMessageId);
  }

  async sendHandoffAcknowledgement(
    conversationId: string,
    text: string,
    sourceMessageId: string,
  ): Promise<void> {
    await this.#send(conversationId, text, SenderType.SYSTEM, true, sourceMessageId);
  }

  async #send(
    conversationId: string,
    text: string,
    senderType: SenderType,
    handoffAcknowledgement: boolean,
    sourceMessageId: string,
  ): Promise<void> {
    if (await this.prisma.message.findUnique({ where: { sourceMessageId } })) {
      this.logger.info({ conversationId, sourceMessageId }, 'duplicate business send suppressed');
      return;
    }
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        handoffs: {
          where: { activeKey: { not: null } },
          take: 1,
        },
        businessAccount: {
          include: {
            connections: { orderBy: { updatedAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    const connection = conversation.businessAccount.connections[0];
    if (!connection?.enabled) {
      throw new AppError('Business connection is disabled', 'BUSINESS_CONNECTION_DISABLED', 409);
    }
    if (!connection.canReply) {
      throw new AppError('Business connection lacks can_reply', 'BUSINESS_CAN_REPLY_MISSING', 409);
    }
    if (handoffAcknowledgement) {
      if (conversation.mode !== ConversationMode.HUMAN || conversation.handoffs.length === 0) {
        throw new AppError(
          'No active handoff for system acknowledgement',
          'NO_ACTIVE_HANDOFF',
          409,
        );
      }
    } else if (conversation.mode !== ConversationMode.AI) {
      throw new AppError('Conversation is no longer in AI mode', 'CONVERSATION_NOT_AI', 409);
    }
    if (
      !conversation.telegramReplyWindowExpiresAt ||
      conversation.telegramReplyWindowExpiresAt <= new Date()
    ) {
      throw new AppError('Telegram reply window has expired', 'TELEGRAM_REPLY_WINDOW_EXPIRED', 409);
    }

    const sent = await this.telegram.sendMessage(conversation.telegramChatId, text, {
      businessConnectionId: connection.id,
    });
    await this.prisma.message.upsert({
      where: {
        businessConnectionId_telegramChatId_telegramMessageId: {
          businessConnectionId: connection.id,
          telegramChatId: conversation.telegramChatId,
          telegramMessageId: telegramId(sent.message_id),
        },
      },
      create: {
        id: newId(),
        conversationId,
        businessConnectionId: connection.id,
        telegramChatId: conversation.telegramChatId,
        telegramMessageId: telegramId(sent.message_id),
        senderType,
        direction: MessageDirection.OUTGOING,
        text,
        sentAt: new Date(sent.date * 1_000),
        processingStatus: MessageProcessingStatus.NOT_APPLICABLE,
        sourceMessageId,
        rawMetadata: { persistedFromSendResponse: true },
      },
      update: { senderType, text, sourceMessageId },
    });
    this.logger.info({ conversationId, senderType }, 'business message sent');
  }
}
