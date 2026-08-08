import {
  MessageDirection,
  MessageProcessingStatus,
  Prisma,
  SenderType,
  TelegramBotKind,
  type BusinessConnection,
  type PrismaClient,
} from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { newId, telegramId } from '../utils/ids.js';
import { hoursFrom, millisecondsFrom } from '../utils/time.js';
import { AppError, ValidationError } from '../utils/errors.js';
import type { BusinessConnectionUpdate, TelegramMessage, TelegramUpdate } from './types.js';
import { businessCanReply } from './types.js';
import type { TelegramApi } from './client.js';
import { telegramUpdateIdentity } from './idempotency.js';

export interface IngestResult {
  duplicate: boolean;
  type: string;
  conversationId?: string;
  messageId?: string;
}

function persistedRights(connection: BusinessConnectionUpdate): Prisma.InputJsonObject {
  return JSON.parse(
    JSON.stringify(connection.rights ?? { can_reply: connection.can_reply ?? false }),
  ) as Prisma.InputJsonObject;
}

export function classifyBusinessMessage(
  message: TelegramMessage,
  businessAccountTelegramId: bigint | null,
): { senderType: SenderType; direction: MessageDirection } {
  if (message.sender_business_bot) {
    return { senderType: SenderType.AI, direction: MessageDirection.OUTGOING };
  }
  const fromId = message.from ? telegramId(message.from.id) : null;
  if (businessAccountTelegramId !== null && fromId === businessAccountTelegramId) {
    return { senderType: SenderType.HUMAN, direction: MessageDirection.OUTGOING };
  }
  return { senderType: SenderType.CUSTOMER, direction: MessageDirection.INCOMING };
}

export class BusinessUpdateIngestor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly telegram: TelegramApi,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async ingest(update: TelegramUpdate, correlationId: string): Promise<IngestResult> {
    try {
      if (update.business_connection) {
        return await this.#syncConnection(update, correlationId);
      }
      if (update.business_message) {
        await this.#ensureConnection(update.business_message);
        const result = await this.#storeMessage(
          update,
          update.business_message,
          false,
          correlationId,
        );
        return result;
      }
      if (update.edited_business_message) {
        return await this.#editMessage(update, update.edited_business_message, correlationId);
      }
      if (update.deleted_business_messages) {
        return await this.#deleteMessages(update, correlationId);
      }
      return await this.#markIgnored(update, correlationId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { duplicate: true, type: this.#updateType(update) };
      }
      throw error;
    }
  }

  async #ensureConnection(message: TelegramMessage): Promise<void> {
    const id = message.business_connection_id;
    if (!id)
      throw new ValidationError('Business message has no connection ID', 'MISSING_CONNECTION_ID');
    if (await this.prisma.businessConnection.findUnique({ where: { id } })) return;
    const current = await this.telegram.getBusinessConnection(id);
    await this.#upsertConnection(current, BigInt(-1));
  }

  async #syncConnection(update: TelegramUpdate, correlationId: string): Promise<IngestResult> {
    const connection = update.business_connection;
    if (!connection) throw new Error('Connection update missing');
    await this.prisma.$transaction(async (tx) => {
      await this.#insertProcessed(tx, update, correlationId);
      const saved = await this.#upsertConnection(connection, telegramId(update.update_id), tx);
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId: saved.businessAccountId,
          actorType: 'SYSTEM',
          action: connection.is_enabled
            ? 'BUSINESS_CONNECTION_ENABLED'
            : 'BUSINESS_CONNECTION_DISABLED',
          entityType: 'BusinessConnection',
          entityId: connection.id,
          correlationId,
          metadata: { canReply: businessCanReply(connection) },
        },
      });
    });
    this.logger.info(
      {
        connectionId: connection.id,
        enabled: connection.is_enabled,
        canReply: businessCanReply(connection),
      },
      'business connection updated',
    );
    return { duplicate: false, type: 'business_connection' };
  }

  async #upsertConnection(
    connection: BusinessConnectionUpdate,
    updateId: bigint,
    client: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<BusinessConnection> {
    const accountTelegramId = telegramId(connection.user.id);
    let account = await client.businessAccount.findFirst({
      where: { telegramAccountUserId: accountTelegramId },
    });
    if (!account) {
      const unbound = await client.businessAccount.findMany({
        where: { telegramAccountUserId: null, isActive: true },
        take: 2,
      });
      if (unbound.length !== 1 || !unbound[0]) {
        throw new AppError(
          'No unambiguous business account is available for this Telegram connection',
          'BUSINESS_ACCOUNT_MAPPING_REQUIRED',
          409,
          false,
        );
      }
      account = await client.businessAccount.update({
        where: { id: unbound[0].id },
        data: { telegramAccountUserId: accountTelegramId },
      });
    }
    return client.businessConnection.upsert({
      where: { id: connection.id },
      create: {
        id: connection.id,
        businessAccountId: account.id,
        telegramUserChatId: telegramId(connection.user_chat_id),
        enabled: connection.is_enabled,
        canReply: businessCanReply(connection),
        rights: persistedRights(connection),
        connectedAt: connection.is_enabled ? new Date(connection.date * 1_000) : null,
        disabledAt: connection.is_enabled ? null : new Date(connection.date * 1_000),
        lastUpdateId: updateId >= 0 ? updateId : null,
      },
      update: {
        businessAccountId: account.id,
        telegramUserChatId: telegramId(connection.user_chat_id),
        enabled: connection.is_enabled,
        canReply: businessCanReply(connection),
        rights: persistedRights(connection),
        ...(connection.is_enabled
          ? { connectedAt: new Date(connection.date * 1_000), disabledAt: null }
          : { disabledAt: new Date(connection.date * 1_000) }),
        ...(updateId >= 0 ? { lastUpdateId: updateId } : {}),
      },
    });
  }

  async #storeMessage(
    update: TelegramUpdate,
    telegramMessage: TelegramMessage,
    edited: boolean,
    correlationId: string,
  ): Promise<IngestResult> {
    const connectionId = telegramMessage.business_connection_id;
    if (!connectionId) throw new ValidationError('Missing business connection ID');
    const connection = await this.prisma.businessConnection.findUniqueOrThrow({
      where: { id: connectionId },
      include: { businessAccount: true },
    });
    if (telegramMessage.chat.type !== 'private') {
      return this.#markIgnored(update, correlationId);
    }
    const classification = classifyBusinessMessage(
      telegramMessage,
      connection.businessAccount.telegramAccountUserId,
    );
    const trimmedContent = (telegramMessage.text ?? telegramMessage.caption)?.trim();
    const content = trimmedContent === '' ? null : (trimmedContent ?? null);
    if (content && content.length > this.config.rag.maxCustomerMessageLength) {
      throw new ValidationError('Message is too long', 'CUSTOMER_MESSAGE_TOO_LONG');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.#insertProcessed(tx, update, correlationId);
      const from = telegramMessage.from;
      const customerTelegramId =
        classification.senderType === SenderType.CUSTOMER && from
          ? telegramId(from.id)
          : telegramId(telegramMessage.chat.id);
      const customer = await tx.customer.upsert({
        where: {
          businessAccountId_telegramUserId: {
            businessAccountId: connection.businessAccountId,
            telegramUserId: customerTelegramId,
          },
        },
        create: {
          id: newId(),
          businessAccountId: connection.businessAccountId,
          telegramUserId: customerTelegramId,
          username: from?.username ?? telegramMessage.chat.username ?? null,
          firstName: from?.first_name ?? telegramMessage.chat.first_name ?? null,
          lastName: from?.last_name ?? telegramMessage.chat.last_name ?? null,
          languageCode: from?.language_code ?? null,
        },
        update: {
          username: from?.username ?? telegramMessage.chat.username ?? null,
          firstName: from?.first_name ?? telegramMessage.chat.first_name ?? null,
          lastName: from?.last_name ?? telegramMessage.chat.last_name ?? null,
          languageCode: from?.language_code ?? null,
        },
      });
      const sentAt = new Date(telegramMessage.date * 1_000);
      const incomingCustomer = classification.senderType === SenderType.CUSTOMER;
      const conversation = await tx.conversation.upsert({
        where: {
          businessAccountId_customerId: {
            businessAccountId: connection.businessAccountId,
            customerId: customer.id,
          },
        },
        create: {
          id: newId(),
          businessAccountId: connection.businessAccountId,
          customerId: customer.id,
          telegramChatId: telegramId(telegramMessage.chat.id),
          ...(incomingCustomer
            ? {
                lastCustomerMessageAt: sentAt,
                telegramReplyWindowExpiresAt: hoursFrom(
                  sentAt,
                  this.config.telegram.replyWindowHours,
                ),
              }
            : {}),
        },
        update: {
          telegramChatId: telegramId(telegramMessage.chat.id),
          ...(incomingCustomer
            ? {
                lastCustomerMessageAt: sentAt,
                telegramReplyWindowExpiresAt: hoursFrom(
                  sentAt,
                  this.config.telegram.replyWindowHours,
                ),
              }
            : {}),
        },
      });
      const message = await tx.message.upsert({
        where: {
          businessConnectionId_telegramChatId_telegramMessageId: {
            businessConnectionId: connectionId,
            telegramChatId: telegramId(telegramMessage.chat.id),
            telegramMessageId: telegramId(telegramMessage.message_id),
          },
        },
        create: {
          id: newId(),
          conversationId: conversation.id,
          businessConnectionId: connectionId,
          telegramChatId: telegramId(telegramMessage.chat.id),
          telegramMessageId: telegramId(telegramMessage.message_id),
          senderTelegramUserId: from ? telegramId(from.id) : null,
          senderType: classification.senderType,
          direction: classification.direction,
          text: content,
          sentAt,
          editedAt: edited ? new Date() : null,
          processingStatus:
            incomingCustomer && content
              ? MessageProcessingStatus.PENDING
              : MessageProcessingStatus.NOT_APPLICABLE,
          rawMetadata: {
            hasSenderBusinessBot: Boolean(telegramMessage.sender_business_bot),
          },
        },
        update: {
          text: content,
          ...(edited ? { editedAt: new Date() } : {}),
          rawMetadata: {
            hasSenderBusinessBot: Boolean(telegramMessage.sender_business_bot),
          },
        },
      });
      if (incomingCustomer && content) {
        await tx.conversationJob.upsert({
          where: { messageId: message.id },
          create: {
            id: newId(),
            conversationId: conversation.id,
            messageId: message.id,
            processAfter: millisecondsFrom(new Date(), this.config.rag.debounceMs),
          },
          update: {},
        });
      }
      return {
        duplicate: false,
        type: 'business_message',
        conversationId: conversation.id,
        messageId: message.id,
      };
    });
  }

  async #editMessage(
    update: TelegramUpdate,
    message: TelegramMessage,
    correlationId: string,
  ): Promise<IngestResult> {
    const connectionId = message.business_connection_id;
    if (!connectionId) throw new ValidationError('Missing business connection ID');
    await this.prisma.$transaction(async (tx) => {
      await this.#insertProcessed(tx, update, correlationId);
      await tx.message.updateMany({
        where: {
          businessConnectionId: connectionId,
          telegramChatId: telegramId(message.chat.id),
          telegramMessageId: telegramId(message.message_id),
        },
        data: {
          text: (() => {
            const value = (message.text ?? message.caption)?.trim();
            return value === '' ? null : (value ?? null);
          })(),
          editedAt: new Date(),
        },
      });
    });
    return { duplicate: false, type: 'edited_business_message' };
  }

  async #deleteMessages(update: TelegramUpdate, correlationId: string): Promise<IngestResult> {
    const deleted = update.deleted_business_messages;
    if (!deleted) throw new Error('Deleted message update missing');
    await this.prisma.$transaction(async (tx) => {
      await this.#insertProcessed(tx, update, correlationId);
      await tx.message.updateMany({
        where: {
          businessConnectionId: deleted.business_connection_id,
          telegramChatId: telegramId(deleted.chat.id),
          telegramMessageId: { in: deleted.message_ids.map(telegramId) },
        },
        data: { deletedAt: new Date(), text: null },
      });
    });
    return { duplicate: false, type: 'deleted_business_messages' };
  }

  async #markIgnored(update: TelegramUpdate, correlationId: string): Promise<IngestResult> {
    await this.prisma.processedTelegramUpdate.create({
      data: {
        id: telegramUpdateIdentity(TelegramBotKind.BUSINESS, update.update_id),
        botKind: TelegramBotKind.BUSINESS,
        updateId: telegramId(update.update_id),
        updateType: 'ignored',
        correlationId,
      },
    });
    return { duplicate: false, type: 'ignored' };
  }

  async #insertProcessed(
    tx: Prisma.TransactionClient,
    update: TelegramUpdate,
    correlationId: string,
  ): Promise<void> {
    await tx.processedTelegramUpdate.create({
      data: {
        id: telegramUpdateIdentity(TelegramBotKind.BUSINESS, update.update_id),
        botKind: TelegramBotKind.BUSINESS,
        updateId: telegramId(update.update_id),
        updateType: this.#updateType(update),
        correlationId,
      },
    });
  }

  #updateType(update: TelegramUpdate): string {
    if (update.business_connection) return 'business_connection';
    if (update.business_message) return 'business_message';
    if (update.edited_business_message) return 'edited_business_message';
    if (update.deleted_business_messages) return 'deleted_business_messages';
    return 'ignored';
  }
}
