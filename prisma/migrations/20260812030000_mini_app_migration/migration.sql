-- The Mini App replaces the durable conversational Admin Bot flows. All source
-- records and audit history remain intact; only the obsolete transient flow
-- table is removed after the replacement session and management tables exist.

ALTER TABLE `Handoff`
    ADD COLUMN `claimedAt` DATETIME(3) NULL,
    ADD COLUMN `claimedBy` CHAR(36) NULL,
    ADD COLUMN `resolutionOutcome` VARCHAR(80) NULL,
    ADD COLUMN `resolutionNote` TEXT NULL;

CREATE TABLE `KnowledgeDraft` (
    `id` CHAR(36) NOT NULL,
    `businessAccountId` CHAR(36) NOT NULL,
    `knowledgeItemId` CHAR(36) NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` LONGTEXT NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `createdByAdminId` CHAR(36) NOT NULL,
    `updatedByAdminId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KnowledgeDraft_knowledgeItemId_key`(`knowledgeItemId`),
    INDEX `KnowledgeDraft_businessAccountId_updatedAt_idx`(`businessAccountId`, `updatedAt`),
    INDEX `KnowledgeDraft_updatedByAdminId_idx`(`updatedByAdminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AdminSession` (
    `id` CHAR(36) NOT NULL,
    `adminId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `csrfHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AdminSession_tokenHash_key`(`tokenHash`),
    INDEX `AdminSession_adminId_expiresAt_idx`(`adminId`, `expiresAt`),
    INDEX `AdminSession_expiresAt_revokedAt_idx`(`expiresAt`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Notification` (
    `id` CHAR(36) NOT NULL,
    `dedupeKey` VARCHAR(190) NOT NULL,
    `type` VARCHAR(80) NOT NULL,
    `severity` ENUM('INFO', 'SUCCESS', 'WARNING', 'ERROR') NOT NULL,
    `businessAccountId` CHAR(36) NULL,
    `relatedEntityType` VARCHAR(80) NOT NULL,
    `relatedEntityId` VARCHAR(128) NOT NULL,
    `titleFa` VARCHAR(200) NOT NULL,
    `summaryFa` VARCHAR(500) NOT NULL,
    `destinationPath` VARCHAR(500) NOT NULL,
    `publicToken` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Notification_dedupeKey_key`(`dedupeKey`),
    UNIQUE INDEX `Notification_publicToken_key`(`publicToken`),
    INDEX `Notification_businessAccountId_createdAt_idx`(`businessAccountId`, `createdAt`),
    INDEX `Notification_relatedEntityType_relatedEntityId_idx`(`relatedEntityType`, `relatedEntityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `NotificationDelivery` (
    `id` CHAR(36) NOT NULL,
    `notificationId` CHAR(36) NOT NULL,
    `adminId` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'RETRY', 'DELIVERED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 8,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseOwner` VARCHAR(64) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `lastErrorCode` VARCHAR(100) NULL,
    `telegramMessageId` BIGINT NULL,
    `deliveredAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NotificationDelivery_notificationId_adminId_key`(`notificationId`, `adminId`),
    INDEX `NotificationDelivery_status_availableAt_idx`(`status`, `availableAt`),
    INDEX `NotificationDelivery_leaseExpiresAt_idx`(`leaseExpiresAt`),
    INDEX `NotificationDelivery_adminId_readAt_createdAt_idx`(`adminId`, `readAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `KnowledgeDraft` ADD CONSTRAINT `KnowledgeDraft_businessAccountId_fkey`
    FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `KnowledgeDraft` ADD CONSTRAINT `KnowledgeDraft_knowledgeItemId_fkey`
    FOREIGN KEY (`knowledgeItemId`) REFERENCES `KnowledgeItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `KnowledgeDraft` ADD CONSTRAINT `KnowledgeDraft_createdByAdminId_fkey`
    FOREIGN KEY (`createdByAdminId`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AdminSession` ADD CONSTRAINT `AdminSession_adminId_fkey`
    FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_businessAccountId_fkey`
    FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `NotificationDelivery` ADD CONSTRAINT `NotificationDelivery_notificationId_fkey`
    FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `NotificationDelivery` ADD CONSTRAINT `NotificationDelivery_adminId_fkey`
    FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE `AdminFlowState`;
