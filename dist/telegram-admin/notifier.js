import { createHash } from 'node:crypto';
import { NotificationDeliveryStatus, NotificationSeverity, } from '@prisma/client';
import { errorCode } from '../utils/errors.js';
import { newId } from '../utils/ids.js';
import { millisecondsFrom } from '../utils/time.js';
function shortHash(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
function businessDestination(path, businessAccountId) {
    return `${path}?business=${encodeURIComponent(businessAccountId)}`;
}
export class AdminNotifier {
    prisma;
    telegram;
    config;
    logger;
    constructor(prisma, telegram, config, logger) {
        this.prisma = prisma;
        this.telegram = telegram;
        this.config = config;
        this.logger = logger;
    }
    async enqueue(client, input) {
        const notification = await client.notification.upsert({
            where: { dedupeKey: input.dedupeKey },
            create: {
                id: newId(),
                publicToken: newId(),
                dedupeKey: input.dedupeKey,
                type: input.type,
                severity: input.severity,
                businessAccountId: input.businessAccountId ?? null,
                relatedEntityType: input.relatedEntityType,
                relatedEntityId: input.relatedEntityId,
                titleFa: input.titleFa,
                summaryFa: input.summaryFa,
                destinationPath: input.destinationPath,
            },
            update: {},
        });
        const recipients = await client.admin.findMany({
            where: {
                isActive: true,
                ...(input.businessAccountId
                    ? { businessAccess: { some: { businessAccountId: input.businessAccountId } } }
                    : {}),
            },
            select: { id: true },
        });
        if (recipients.length === 0)
            return;
        await client.notificationDelivery.createMany({
            data: recipients.map((admin) => ({
                id: newId(),
                notificationId: notification.id,
                adminId: admin.id,
            })),
            skipDuplicates: true,
        });
    }
    async handoffActivatedInTransaction(client, input) {
        await this.enqueue(client, {
            dedupeKey: `HANDOFF_ACTIVATED:${input.handoffId}`,
            type: 'HANDOFF_ACTIVATED',
            severity: NotificationSeverity.WARNING,
            businessAccountId: input.businessAccountId,
            relatedEntityType: 'Conversation',
            relatedEntityId: input.conversationId,
            titleFa: '🔔 ارجاع جدید',
            summaryFa: 'پیام مشتری برای بررسی انسانی ارجاع شد.',
            destinationPath: businessDestination(`/handoffs/${input.conversationId}`, input.businessAccountId),
        });
    }
    async additionalCustomerMessage(conversationId, _message) {
        void _message;
        const conversation = await this.prisma.conversation.findUniqueOrThrow({
            where: { id: conversationId },
            include: { messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { id: true } } },
        });
        const messageId = conversation.messages[0]?.id ?? shortHash(`${conversationId}:${Date.now()}`);
        await this.enqueue(this.prisma, {
            dedupeKey: `HANDOFF_MESSAGE:${messageId}`,
            type: 'HANDOFF_MESSAGE',
            severity: NotificationSeverity.INFO,
            businessAccountId: conversation.businessAccountId,
            relatedEntityType: 'Conversation',
            relatedEntityId: conversation.id,
            titleFa: '💬 پیام جدید در ارجاع',
            summaryFa: 'مشتری در گفتگوی تحت رسیدگی پیام تازه‌ای فرستاد.',
            destinationPath: businessDestination(`/handoffs/${conversation.id}`, conversation.businessAccountId),
        });
    }
    async aiRestored(conversationId, automatic) {
        const conversation = await this.prisma.conversation.findUniqueOrThrow({
            where: { id: conversationId },
        });
        await this.enqueue(this.prisma, {
            dedupeKey: `AI_RESTORED:${conversation.id}:${conversation.updatedAt.toISOString()}`,
            type: 'AI_RESTORED',
            severity: NotificationSeverity.SUCCESS,
            businessAccountId: conversation.businessAccountId,
            relatedEntityType: 'Conversation',
            relatedEntityId: conversation.id,
            titleFa: '✅ پاسخ‌گویی هوشمند فعال شد',
            summaryFa: automatic
                ? 'حالت هوشمند پس از پایان زمان ارجاع دوباره فعال شد.'
                : 'حالت هوشمند برای گفتگو دوباره فعال شد.',
            destinationPath: businessDestination(`/conversations/${conversation.id}`, conversation.businessAccountId),
        });
    }
    async aiRestoredInTransaction(client, input) {
        await this.enqueue(client, {
            dedupeKey: `AI_RESTORED:${input.conversationId}:${input.eventKey}`,
            type: 'AI_RESTORED',
            severity: NotificationSeverity.SUCCESS,
            businessAccountId: input.businessAccountId,
            relatedEntityType: 'Conversation',
            relatedEntityId: input.conversationId,
            titleFa: '✅ پاسخ‌گویی هوشمند فعال شد',
            summaryFa: input.automatic
                ? 'حالت هوشمند پس از پایان زمان ارجاع دوباره فعال شد.'
                : 'حالت هوشمند برای گفتگو دوباره فعال شد.',
            destinationPath: businessDestination(`/conversations/${input.conversationId}`, input.businessAccountId),
        });
    }
    async indexingFailed(input) {
        await this.enqueue(this.prisma, {
            dedupeKey: `INDEXING_FAILED:${input.knowledgeId}:${input.knowledgeVersion ?? 'current'}:${shortHash(input.errorCode)}`,
            type: 'INDEXING_FAILED',
            severity: NotificationSeverity.ERROR,
            businessAccountId: input.businessAccountId,
            relatedEntityType: 'KnowledgeItem',
            relatedEntityId: input.knowledgeId,
            titleFa: '❌ خطا در پردازش دانش',
            summaryFa: `نمایه‌سازی «${input.title.slice(0, 150)}» انجام نشد.`,
            destinationPath: businessDestination(`/knowledge/${input.knowledgeId}`, input.businessAccountId),
        });
    }
    async indexingFailedInTransaction(client, input) {
        await this.enqueue(client, {
            dedupeKey: `INDEXING_FAILED:${input.knowledgeId}:${input.knowledgeVersion ?? 'current'}:${shortHash(input.errorCode)}`,
            type: 'INDEXING_FAILED',
            severity: NotificationSeverity.ERROR,
            businessAccountId: input.businessAccountId,
            relatedEntityType: 'KnowledgeItem',
            relatedEntityId: input.knowledgeId,
            titleFa: '❌ خطا در پردازش دانش',
            summaryFa: `نمایه‌سازی «${input.title.slice(0, 150)}» انجام نشد.`,
            destinationPath: businessDestination(`/knowledge/${input.knowledgeId}`, input.businessAccountId),
        });
    }
    async indexingSucceeded(input) {
        await this.enqueue(this.prisma, {
            dedupeKey: `INDEXING_SUCCEEDED:${input.knowledgeId}:${input.knowledgeVersion ?? 'current'}`,
            type: 'INDEXING_SUCCEEDED',
            severity: NotificationSeverity.SUCCESS,
            businessAccountId: input.businessAccountId,
            relatedEntityType: 'KnowledgeItem',
            relatedEntityId: input.knowledgeId,
            titleFa: '✅ دانش آماده استفاده است',
            summaryFa: `«${input.title.slice(0, 150)}» با موفقیت منتشر شد.`,
            destinationPath: businessDestination(`/knowledge/${input.knowledgeId}`, input.businessAccountId),
        });
    }
    async indexingSucceededInTransaction(client, input) {
        await this.enqueue(client, {
            dedupeKey: `INDEXING_SUCCEEDED:${input.knowledgeId}:${input.knowledgeVersion ?? 'current'}`,
            type: 'INDEXING_SUCCEEDED',
            severity: NotificationSeverity.SUCCESS,
            businessAccountId: input.businessAccountId,
            relatedEntityType: 'KnowledgeItem',
            relatedEntityId: input.knowledgeId,
            titleFa: '✅ دانش آماده استفاده است',
            summaryFa: `«${input.title.slice(0, 150)}» با موفقیت منتشر شد.`,
            destinationPath: businessDestination(`/knowledge/${input.knowledgeId}`, input.businessAccountId),
        });
    }
    async systemAttention(businessAccountId, text) {
        await this.enqueue(this.prisma, {
            dedupeKey: `SYSTEM_ATTENTION:${businessAccountId}:${shortHash(text)}`,
            type: 'SYSTEM_ATTENTION',
            severity: NotificationSeverity.ERROR,
            businessAccountId,
            relatedEntityType: 'System',
            relatedEntityId: businessAccountId,
            titleFa: '⚠️ سامانه نیازمند بررسی است',
            summaryFa: 'یک اختلال عملیاتی بر پاسخ‌گویی سامانه اثر گذاشته است.',
            destinationPath: businessDestination('/system', businessAccountId),
        });
    }
    async nanoGptLowBalance(_balanceUsd, _thresholdUsd) {
        void _balanceUsd;
        void _thresholdUsd;
        const day = new Date().toISOString().slice(0, 10);
        await this.enqueue(this.prisma, {
            dedupeKey: `PROVIDER_LOW_BALANCE:${day}`,
            type: 'PROVIDER_LOW_BALANCE',
            severity: NotificationSeverity.WARNING,
            relatedEntityType: 'System',
            relatedEntityId: 'provider-credit',
            titleFa: '⚠️ اعتبار سرویس رو به پایان است',
            summaryFa: 'اعتبار باقی‌مانده از حد تعیین‌شده کمتر است.',
            destinationPath: '/system',
        });
    }
    async nanoGptInsufficientBalance(_balanceUsd) {
        void _balanceUsd;
        const day = new Date().toISOString().slice(0, 10);
        await this.enqueue(this.prisma, {
            dedupeKey: `PROVIDER_INSUFFICIENT_BALANCE:${day}`,
            type: 'PROVIDER_INSUFFICIENT_BALANCE',
            severity: NotificationSeverity.ERROR,
            relatedEntityType: 'System',
            relatedEntityId: 'provider-credit',
            titleFa: '🚨 پاسخ‌گویی هوشمند با اختلال روبه‌رو است',
            summaryFa: 'اعتبار سرویس برای پردازش درخواست‌ها کافی نیست.',
            destinationPath: '/system',
        });
    }
    async runBatch(workerId) {
        const now = new Date();
        const candidates = await this.prisma.notificationDelivery.findMany({
            where: {
                status: {
                    in: [
                        NotificationDeliveryStatus.PENDING,
                        NotificationDeliveryStatus.RETRY,
                        NotificationDeliveryStatus.PROCESSING,
                    ],
                },
                availableAt: { lte: now },
                OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
            },
            orderBy: { availableAt: 'asc' },
            take: this.config.worker.batchSize,
            select: { id: true },
        });
        let processed = 0;
        for (const candidate of candidates) {
            const claimed = await this.prisma.notificationDelivery.updateMany({
                where: {
                    id: candidate.id,
                    status: {
                        in: [
                            NotificationDeliveryStatus.PENDING,
                            NotificationDeliveryStatus.RETRY,
                            NotificationDeliveryStatus.PROCESSING,
                        ],
                    },
                    OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
                },
                data: {
                    status: NotificationDeliveryStatus.PROCESSING,
                    attempts: { increment: 1 },
                    leaseOwner: workerId,
                    leaseExpiresAt: millisecondsFrom(now, this.config.worker.leaseMs),
                },
            });
            if (claimed.count !== 1)
                continue;
            processed += 1;
            const delivery = await this.prisma.notificationDelivery.findUniqueOrThrow({
                where: { id: candidate.id },
                include: { notification: true, admin: true },
            });
            try {
                const destination = `${this.config.telegram.miniAppUrl}${delivery.notification.destinationPath}`;
                const buttonText = delivery.notification.type.startsWith('AI_MASTER_')
                    ? 'مشاهده تنظیمات'
                    : 'مشاهده جزئیات';
                const sent = await this.telegram.sendMessage(delivery.admin.telegramUserId, `${delivery.notification.titleFa}\n${delivery.notification.summaryFa}`, {
                    replyMarkup: {
                        inline_keyboard: [[{ text: buttonText, web_app: { url: destination } }]],
                    },
                });
                await this.prisma.notificationDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: NotificationDeliveryStatus.DELIVERED,
                        telegramMessageId: BigInt(sent.message_id),
                        deliveredAt: new Date(),
                        leaseOwner: null,
                        leaseExpiresAt: null,
                        lastErrorCode: null,
                    },
                });
            }
            catch (error) {
                const terminal = delivery.attempts >= delivery.maxAttempts;
                await this.prisma.notificationDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: terminal ? NotificationDeliveryStatus.FAILED : NotificationDeliveryStatus.RETRY,
                        availableAt: millisecondsFrom(new Date(), Math.min(3_600_000, 2 ** delivery.attempts * 1_000)),
                        leaseOwner: null,
                        leaseExpiresAt: null,
                        lastErrorCode: errorCode(error),
                    },
                });
                this.logger.error({ err: error, notificationDeliveryId: delivery.id, attempt: delivery.attempts }, 'admin notification delivery failed');
            }
        }
        return processed;
    }
}
//# sourceMappingURL=notifier.js.map