import {
  ConversationMode,
  HandoffStatus,
  Prisma,
  type Admin,
  type Conversation,
  type Handoff,
  type PrismaClient,
} from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { newId } from '../utils/ids.js';
import { hoursFrom } from '../utils/time.js';
import { AppError } from '../utils/errors.js';

export interface ModeChangeNotifier {
  aiRestored(conversationId: string, automatic: boolean): Promise<void>;
}

export class HandoffService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly notifier?: ModeChangeNotifier,
  ) {}

  async activate(
    conversationId: string,
    reasonCode: string,
    reasonDetail?: string,
    now = new Date(),
  ): Promise<{ conversation: Conversation; handoff: Handoff; created: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.handoff.findUnique({
          where: { activeKey: `active:${conversationId}` },
        });
        if (existing) {
          return {
            conversation: await tx.conversation.findUniqueOrThrow({
              where: { id: conversationId },
            }),
            handoff: existing,
            created: false,
          };
        }
        const expiresAt = hoursFrom(now, this.config.handoff.hours);
        const changed = await tx.conversation.updateMany({
          where: {
            id: conversationId,
            mode: { in: [ConversationMode.AI, ConversationMode.PENDING_HUMAN] },
          },
          data: {
            mode: ConversationMode.HUMAN,
            humanModeStartedAt: now,
            humanModeExpiresAt: expiresAt,
          },
        });
        if (changed.count !== 1) {
          throw new AppError(
            'Conversation cannot enter human mode',
            'HANDOFF_TRANSITION_REJECTED',
            409,
          );
        }
        const handoff = await tx.handoff.create({
          data: {
            id: newId(),
            conversationId,
            reasonCode,
            reasonDetail: reasonDetail ?? null,
            activeKey: `active:${conversationId}`,
            startedAt: now,
            expiresAt,
          },
        });
        const conversation = await tx.conversation.findUniqueOrThrow({
          where: { id: conversationId },
        });
        await tx.auditLog.create({
          data: {
            id: newId(),
            businessAccountId: conversation.businessAccountId,
            actorType: 'SYSTEM',
            action: 'HUMAN_MODE_ACTIVATED',
            entityType: 'Conversation',
            entityId: conversationId,
            metadata: { reasonCode, handoffId: handoff.id, expiresAt: expiresAt.toISOString() },
          },
        });
        return { conversation, handoff, created: true };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const handoff = await this.prisma.handoff.findUniqueOrThrow({
          where: { activeKey: `active:${conversationId}` },
        });
        return {
          conversation: await this.prisma.conversation.findUniqueOrThrow({
            where: { id: conversationId },
          }),
          handoff,
          created: false,
        };
      }
      throw error;
    }
  }

  async enableAiNow(conversationId: string, admin: Admin, now = new Date()): Promise<boolean> {
    const changed = await this.prisma.$transaction(async (tx) => {
      const update = await tx.conversation.updateMany({
        where: { id: conversationId, mode: ConversationMode.HUMAN },
        data: { mode: ConversationMode.AI, humanModeStartedAt: null, humanModeExpiresAt: null },
      });
      if (update.count !== 1) return false;
      await tx.handoff.updateMany({
        where: { conversationId, activeKey: { not: null } },
        data: {
          status: HandoffStatus.RESOLVED,
          resolvedAt: now,
          resolvedBy: admin.id,
          activeKey: null,
        },
      });
      const conversation = await tx.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId: conversation.businessAccountId,
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'AI_MODE_ENABLED_MANUALLY',
          entityType: 'Conversation',
          entityId: conversationId,
        },
      });
      return true;
    });
    if (changed) await this.notifier?.aiRestored(conversationId, false);
    return changed;
  }

  async extend(conversationId: string, admin: Admin, now = new Date()): Promise<Date> {
    const expiresAt = hoursFrom(now, this.config.handoff.hours);
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.conversation.updateMany({
        where: { id: conversationId, mode: ConversationMode.HUMAN },
        data: { humanModeExpiresAt: expiresAt },
      });
      if (changed.count !== 1)
        throw new AppError('Conversation is not in human mode', 'NOT_HUMAN_MODE', 409);
      await tx.handoff.updateMany({
        where: { conversationId, activeKey: { not: null } },
        data: { expiresAt },
      });
      const conversation = await tx.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessAccountId: conversation.businessAccountId,
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'HUMAN_MODE_EXTENDED',
          entityType: 'Conversation',
          entityId: conversationId,
          metadata: { expiresAt: expiresAt.toISOString() },
        },
      });
      return expiresAt;
    });
  }

  async acknowledge(conversationId: string, admin: Admin, now = new Date()): Promise<void> {
    await this.prisma.handoff.updateMany({
      where: { conversationId, status: HandoffStatus.WAITING, activeKey: { not: null } },
      data: {
        status: HandoffStatus.ACKNOWLEDGED,
        acknowledgedAt: now,
        acknowledgedBy: admin.id,
      },
    });
  }

  async expireBatch(now = new Date()): Promise<number> {
    const expired = await this.prisma.conversation.findMany({
      where: { mode: ConversationMode.HUMAN, humanModeExpiresAt: { lte: now } },
      select: { id: true },
      take: this.config.worker.batchSize,
    });
    let count = 0;
    for (const candidate of expired) {
      const changed = await this.prisma.$transaction(async (tx) => {
        const update = await tx.conversation.updateMany({
          where: {
            id: candidate.id,
            mode: ConversationMode.HUMAN,
            humanModeExpiresAt: { lte: now },
          },
          data: { mode: ConversationMode.AI, humanModeStartedAt: null, humanModeExpiresAt: null },
        });
        if (update.count !== 1) return false;
        await tx.handoff.updateMany({
          where: { conversationId: candidate.id, activeKey: { not: null } },
          data: {
            status: HandoffStatus.EXPIRED,
            resolvedAt: now,
            activeKey: null,
          },
        });
        const conversation = await tx.conversation.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        await tx.auditLog.create({
          data: {
            id: newId(),
            businessAccountId: conversation.businessAccountId,
            actorType: 'SYSTEM',
            action: 'AI_MODE_RESTORED_AUTOMATICALLY',
            entityType: 'Conversation',
            entityId: candidate.id,
          },
        });
        return true;
      });
      if (changed) {
        count += 1;
        this.logger.info({ conversationId: candidate.id }, 'AI mode restored automatically');
        await this.notifier
          ?.aiRestored(candidate.id, true)
          .catch((error: unknown) =>
            this.logger.error(
              { err: error, conversationId: candidate.id },
              'AI restore notification failed',
            ),
          );
      }
    }
    return count;
  }
}
