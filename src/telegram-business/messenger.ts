import {
  ConversationMode,
  MessageDirection,
  MessageProcessingStatus,
  SenderType,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { TelegramApi } from './client.js';
import type { SentTelegramMessage } from './types.js';
import { AppError } from '../utils/errors.js';
import { newId, telegramId } from '../utils/ids.js';
import { calculateTypingDelayMs, splitSupportAnswer } from './splitter.js';
import type { SystemLogger } from '../observability/system-logger.js';
import {
  isTelegramEntityParseError,
  sanitizeTelegramHtml,
  stripHtml,
} from '../utils/telegram-format.js';

const typingRefreshMs = 4_000;

export class BusinessMessenger {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly telegram: TelegramApi,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly systemLogger?: SystemLogger,
  ) {}

  async sendAiAnswer(conversationId: string, text: string, sourceMessageId: string): Promise<void> {
    if (await this.prisma.message.findUnique({ where: { sourceMessageId } })) {
      this.logger.info({ conversationId, sourceMessageId }, 'duplicate business send suppressed');
      return;
    }

    const { conversation, connection } = await this.#validateAndGetContext(conversationId, false);
    const parts = splitSupportAnswer(text);

    this.logger.trace(
      {
        category: 'TELEGRAM',
        conversationId,
        sourceMessageId,
        totalChars: text.length,
        partsCount: parts.length,
      },
      'ai answer split into parts for telegram delivery',
    );

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part) continue;
      if (index > 0) {
        // Trigger typing indicator and natural delay between consecutive messages
        await this.telegram
          .sendChatAction(conversation.telegramChatId, 'typing', {
            businessConnectionId: connection.id,
          })
          .catch((error: unknown) => {
            this.logger.debug(
              { err: error, conversationId },
              'inter-message typing indicator failed',
            );
          });

        const delayMs = calculateTypingDelayMs(part.length);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      await this.#sendPart({
        conversationId,
        telegramChatId: conversation.telegramChatId,
        connectionId: connection.id,
        text: part,
        senderType: SenderType.AI,
        sourceMessageId: index === 0 ? sourceMessageId : null,
        metadata: {
          persistedFromSendResponse: true,
          splitPartIndex: index,
          splitTotalParts: parts.length,
          ...(index > 0 ? { parentSourceMessageId: sourceMessageId } : {}),
        },
      });
    }

    await this.#markSourceAsRead(sourceMessageId);
    this.logger.info(
      { conversationId, partsCount: parts.length, senderType: SenderType.AI },
      'business AI message(s) sent',
    );
  }

  async whileTyping<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: {
        telegramChatId: true,
        businessAccount: {
          select: { connections: { orderBy: { updatedAt: 'desc' }, take: 1 } },
        },
      },
    });
    const connection = conversation.businessAccount.connections[0];
    if (!connection?.enabled || !connection.canReply) return operation();

    let stopped = false;
    let requestInFlight = false;
    const abortController = new AbortController();
    const sendTyping = (): void => {
      if (stopped || requestInFlight) return;
      requestInFlight = true;
      void this.telegram
        .sendChatAction(conversation.telegramChatId, 'typing', {
          businessConnectionId: connection.id,
          signal: abortController.signal,
        })
        .catch((error: unknown) => {
          if (!stopped) {
            this.logger.debug({ err: error, conversationId }, 'typing indicator failed');
          }
        })
        .finally(() => {
          requestInFlight = false;
        });
    };

    sendTyping();
    const refreshTimer = setInterval(sendTyping, typingRefreshMs);
    refreshTimer.unref();
    try {
      return await operation();
    } finally {
      stopped = true;
      clearInterval(refreshTimer);
      abortController.abort();
    }
  }

  async sendHandoffAcknowledgement(
    conversationId: string,
    text: string,
    sourceMessageId: string,
  ): Promise<void> {
    if (await this.prisma.message.findUnique({ where: { sourceMessageId } })) {
      this.logger.info({ conversationId, sourceMessageId }, 'duplicate business send suppressed');
      return;
    }

    const { conversation, connection } = await this.#validateAndGetContext(conversationId, true);
    await this.#sendPart({
      conversationId,
      telegramChatId: conversation.telegramChatId,
      connectionId: connection.id,
      text,
      senderType: SenderType.SYSTEM,
      sourceMessageId,
      metadata: { persistedFromSendResponse: true, handoffAcknowledgement: true },
    });
    this.logger.info(
      { conversationId, senderType: SenderType.SYSTEM },
      'handoff acknowledgement sent',
    );
  }

  async #validateAndGetContext(
    conversationId: string,
    handoffAcknowledgement: boolean,
  ): Promise<{
    conversation: { id: string; telegramChatId: bigint; mode: ConversationMode };
    connection: { id: string };
  }> {
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

    return {
      conversation: {
        id: conversation.id,
        telegramChatId: conversation.telegramChatId,
        mode: conversation.mode,
      },
      connection: { id: connection.id },
    };
  }

  async #sendPart(options: {
    conversationId: string;
    telegramChatId: bigint;
    connectionId: string;
    text: string;
    senderType: SenderType;
    sourceMessageId: string | null;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    this.logger.trace(
      {
        category: 'TELEGRAM',
        conversationId: options.conversationId,
        telegramChatId: options.telegramChatId.toString(),
        textLength: options.text.length,
        partIndex: options.metadata['splitPartIndex'],
        totalParts: options.metadata['splitTotalParts'],
        senderType: options.senderType,
      },
      'sending message part to telegram',
    );

    const formattedHtml = sanitizeTelegramHtml(options.text);
    let sent: SentTelegramMessage;
    try {
      sent = await this.telegram.sendMessage(options.telegramChatId, formattedHtml, {
        businessConnectionId: options.connectionId,
        parseMode: 'HTML',
      });
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'TELEGRAM_SEND_FAILED';
      const isWindow = code === 'TELEGRAM_REPLY_WINDOW_EXPIRED';
      this.systemLogger?.[isWindow ? 'warn' : 'error']({
        category: 'TELEGRAM',
        message: `sendMessage failed: ${code} ${error instanceof Error ? error.message : String(error)}`,
        messageFa: isWindow ? 'پنجره پاسخ تلگرام منقضی شده' : 'ارسال پیام به تلگرام ناموفق بود',
        errorCode: code,
        metadata: {
          conversationId: options.conversationId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (isTelegramEntityParseError(error)) {
        this.logger.warn(
          { conversationId: options.conversationId, err: error },
          'Telegram HTML parsing failed, falling back to plain text',
        );
        const plain = stripHtml(options.text);
        sent = await this.telegram.sendMessage(options.telegramChatId, plain, {
          businessConnectionId: options.connectionId,
        });
      } else {
        throw error;
      }
    }

    await this.prisma.message.upsert({
      where: {
        businessConnectionId_telegramChatId_telegramMessageId: {
          businessConnectionId: options.connectionId,
          telegramChatId: options.telegramChatId,
          telegramMessageId: telegramId(sent.message_id),
        },
      },
      create: {
        id: newId(),
        conversationId: options.conversationId,
        businessConnectionId: options.connectionId,
        telegramChatId: options.telegramChatId,
        telegramMessageId: telegramId(sent.message_id),
        senderType: options.senderType,
        direction: MessageDirection.OUTGOING,
        text: options.text,
        sentAt: new Date(sent.date * 1_000),
        processingStatus: MessageProcessingStatus.NOT_APPLICABLE,
        sourceMessageId: options.sourceMessageId,
        rawMetadata: options.metadata as Prisma.InputJsonValue,
      },
      update: {
        senderType: options.senderType,
        text: options.text,
        sourceMessageId: options.sourceMessageId,
      },
    });

    this.logger.trace(
      {
        category: 'TELEGRAM',
        conversationId: options.conversationId,
        telegramMessageId: sent.message_id.toString(),
        partIndex: options.metadata['splitPartIndex'],
      },
      'message part sent to telegram and persisted to database',
    );
  }

  async #markSourceAsRead(sourceMessageId: string): Promise<void> {
    if (!this.config.telegram.markRead) return;
    const source = await this.prisma.message.findUnique({
      where: { id: sourceMessageId },
      select: {
        senderType: true,
        businessConnectionId: true,
        telegramChatId: true,
        telegramMessageId: true,
        businessConnection: { select: { rights: true } },
      },
    });
    if (source?.senderType !== SenderType.CUSTOMER) return;
    const rights = source.businessConnection.rights;
    const canRead =
      rights !== null &&
      typeof rights === 'object' &&
      !Array.isArray(rights) &&
      rights['can_read_messages'] === true;
    if (!canRead) {
      this.logger.warn(
        { connectionId: source.businessConnectionId },
        'mark-as-read configured but can_read_messages is not granted',
      );
      return;
    }
    await this.telegram
      .readBusinessMessage(
        source.businessConnectionId,
        source.telegramChatId,
        source.telegramMessageId,
      )
      .catch((error: unknown) =>
        this.logger.warn({ err: error, messageId: sourceMessageId }, 'mark-as-read failed'),
      );
  }
}
