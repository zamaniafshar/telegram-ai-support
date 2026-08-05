-- CreateTable
CREATE TABLE `BusinessAccount` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `telegramAccountUserId` BIGINT NULL,
    `defaultLocale` VARCHAR(12) NOT NULL DEFAULT 'fa',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BusinessAccount_telegramAccountUserId_key`(`telegramAccountUserId`),
    INDEX `BusinessAccount_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BusinessConnection` (
    `id` VARCHAR(128) NOT NULL,
    `businessAccountId` CHAR(36) NOT NULL,
    `telegramUserChatId` BIGINT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `canReply` BOOLEAN NOT NULL DEFAULT false,
    `rights` JSON NULL,
    `connectedAt` DATETIME(3) NULL,
    `disabledAt` DATETIME(3) NULL,
    `lastUpdateId` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BusinessConnection_businessAccountId_enabled_idx`(`businessAccountId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Admin` (
    `id` CHAR(36) NOT NULL,
    `telegramUserId` BIGINT NOT NULL,
    `displayName` VARCHAR(200) NULL,
    `role` ENUM('OWNER', 'ADMIN', 'SUPPORT') NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `locale` VARCHAR(12) NOT NULL DEFAULT 'fa',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Admin_telegramUserId_key`(`telegramUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminBusinessAccount` (
    `adminId` CHAR(36) NOT NULL,
    `businessAccountId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminBusinessAccount_businessAccountId_idx`(`businessAccountId`),
    PRIMARY KEY (`adminId`, `businessAccountId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` CHAR(36) NOT NULL,
    `businessAccountId` CHAR(36) NOT NULL,
    `telegramUserId` BIGINT NOT NULL,
    `username` VARCHAR(64) NULL,
    `firstName` VARCHAR(128) NULL,
    `lastName` VARCHAR(128) NULL,
    `languageCode` VARCHAR(12) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Customer_username_idx`(`username`),
    UNIQUE INDEX `Customer_businessAccountId_telegramUserId_key`(`businessAccountId`, `telegramUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` CHAR(36) NOT NULL,
    `businessAccountId` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `telegramChatId` BIGINT NOT NULL,
    `mode` ENUM('AI', 'PENDING_HUMAN', 'HUMAN') NOT NULL DEFAULT 'AI',
    `lastCustomerMessageAt` DATETIME(3) NULL,
    `telegramReplyWindowExpiresAt` DATETIME(3) NULL,
    `humanModeStartedAt` DATETIME(3) NULL,
    `humanModeExpiresAt` DATETIME(3) NULL,
    `processingLeaseOwner` VARCHAR(64) NULL,
    `processingLeaseExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Conversation_mode_humanModeExpiresAt_idx`(`mode`, `humanModeExpiresAt`),
    INDEX `Conversation_processingLeaseExpiresAt_idx`(`processingLeaseExpiresAt`),
    INDEX `Conversation_telegramChatId_idx`(`telegramChatId`),
    UNIQUE INDEX `Conversation_businessAccountId_customerId_key`(`businessAccountId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `businessConnectionId` VARCHAR(128) NOT NULL,
    `telegramChatId` BIGINT NOT NULL,
    `telegramMessageId` BIGINT NOT NULL,
    `senderTelegramUserId` BIGINT NULL,
    `senderType` ENUM('CUSTOMER', 'AI', 'HUMAN', 'SYSTEM') NOT NULL,
    `direction` ENUM('INCOMING', 'OUTGOING') NOT NULL,
    `text` TEXT NULL,
    `editedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `rawMetadata` JSON NULL,
    `processingStatus` ENUM('NOT_APPLICABLE', 'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'NOT_APPLICABLE',
    `processingErrorCode` VARCHAR(100) NULL,
    `sourceMessageId` CHAR(36) NULL,
    `sentAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Message_sourceMessageId_key`(`sourceMessageId`),
    INDEX `Message_conversationId_sentAt_idx`(`conversationId`, `sentAt`),
    INDEX `Message_senderType_direction_idx`(`senderType`, `direction`),
    UNIQUE INDEX `Message_businessConnectionId_telegramChatId_telegramMessageI_key`(`businessConnectionId`, `telegramChatId`, `telegramMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationJob` (
    `id` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `messageId` CHAR(36) NOT NULL,
    `status` ENUM('NOT_APPLICABLE', 'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `processAfter` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `leaseOwner` VARCHAR(64) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `lastErrorCode` VARCHAR(100) NULL,
    `lastErrorDetail` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ConversationJob_messageId_key`(`messageId`),
    INDEX `ConversationJob_status_processAfter_idx`(`status`, `processAfter`),
    INDEX `ConversationJob_leaseExpiresAt_idx`(`leaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Handoff` (
    `id` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `status` ENUM('NONE', 'WAITING', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED') NOT NULL DEFAULT 'WAITING',
    `reasonCode` VARCHAR(100) NOT NULL,
    `reasonDetail` TEXT NULL,
    `activeKey` VARCHAR(80) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `acknowledgedBy` CHAR(36) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Handoff_activeKey_key`(`activeKey`),
    INDEX `Handoff_conversationId_status_idx`(`conversationId`, `status`),
    INDEX `Handoff_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KnowledgeItem` (
    `id` CHAR(36) NOT NULL,
    `businessAccountId` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `indexingStatus` ENUM('PENDING', 'INDEXING', 'READY', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `indexingError` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdByAdminId` CHAR(36) NOT NULL,
    `updatedByAdminId` CHAR(36) NOT NULL,
    `indexingLeaseOwner` VARCHAR(64) NULL,
    `indexingLeaseExpiresAt` DATETIME(3) NULL,

    INDEX `KnowledgeItem_businessAccountId_isActive_deletedAt_idx`(`businessAccountId`, `isActive`, `deletedAt`),
    INDEX `KnowledgeItem_indexingStatus_idx`(`indexingStatus`),
    INDEX `KnowledgeItem_indexingLeaseExpiresAt_idx`(`indexingLeaseExpiresAt`),
    FULLTEXT INDEX `KnowledgeItem_title_description_idx`(`title`, `description`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KnowledgeChunk` (
    `id` CHAR(36) NOT NULL,
    `knowledgeItemId` CHAR(36) NOT NULL,
    `qdrantChunkId` VARCHAR(128) NOT NULL,
    `chunkIndex` INTEGER NOT NULL,
    `knowledgeVersion` INTEGER NOT NULL,
    `content` LONGTEXT NOT NULL,
    `checksum` CHAR(64) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KnowledgeChunk_qdrantChunkId_key`(`qdrantChunkId`),
    INDEX `KnowledgeChunk_knowledgeItemId_isActive_idx`(`knowledgeItemId`, `isActive`),
    UNIQUE INDEX `KnowledgeChunk_knowledgeItemId_knowledgeVersion_chunkIndex_key`(`knowledgeItemId`, `knowledgeVersion`, `chunkIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IndexingJob` (
    `id` CHAR(36) NOT NULL,
    `knowledgeItemId` CHAR(36) NOT NULL,
    `knowledgeVersion` INTEGER NOT NULL,
    `action` ENUM('UPSERT', 'REMOVE') NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'RETRY', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `dedupeKey` VARCHAR(160) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 6,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseOwner` VARCHAR(64) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `lastErrorCode` VARCHAR(100) NULL,
    `lastErrorDetail` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IndexingJob_dedupeKey_key`(`dedupeKey`),
    INDEX `IndexingJob_status_availableAt_idx`(`status`, `availableAt`),
    INDEX `IndexingJob_leaseExpiresAt_idx`(`leaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProcessedTelegramUpdate` (
    `id` VARCHAR(80) NOT NULL,
    `botKind` ENUM('BUSINESS', 'ADMIN') NOT NULL,
    `updateId` BIGINT NOT NULL,
    `updateType` VARCHAR(80) NOT NULL,
    `correlationId` CHAR(36) NOT NULL,
    `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProcessedTelegramUpdate_processedAt_idx`(`processedAt`),
    UNIQUE INDEX `ProcessedTelegramUpdate_botKind_updateId_key`(`botKind`, `updateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiDecisionLog` (
    `id` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `messageId` CHAR(36) NOT NULL,
    `answerable` BOOLEAN NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `reason` TEXT NOT NULL,
    `answer` LONGTEXT NULL,
    `supportingChunkIds` JSON NOT NULL,
    `retrievalResults` JSON NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `promptVersion` VARCHAR(40) NOT NULL,
    `inputTokens` INTEGER NULL,
    `outputTokens` INTEGER NULL,
    `totalTokens` INTEGER NULL,
    `latencyMs` INTEGER NOT NULL,
    `errorCode` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AiDecisionLog_messageId_key`(`messageId`),
    INDEX `AiDecisionLog_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `AiDecisionLog_answerable_createdAt_idx`(`answerable`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` CHAR(36) NOT NULL,
    `businessAccountId` CHAR(36) NULL,
    `actorType` ENUM('ADMIN', 'SYSTEM', 'CUSTOMER') NOT NULL,
    `actorId` VARCHAR(128) NULL,
    `action` VARCHAR(120) NOT NULL,
    `entityType` VARCHAR(80) NOT NULL,
    `entityId` VARCHAR(128) NOT NULL,
    `metadata` JSON NULL,
    `correlationId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_businessAccountId_createdAt_idx`(`businessAccountId`, `createdAt`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminFlowState` (
    `id` CHAR(36) NOT NULL,
    `adminId` CHAR(36) NOT NULL,
    `flow` VARCHAR(80) NOT NULL,
    `step` VARCHAR(80) NOT NULL,
    `data` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminFlowState_adminId_key`(`adminId`),
    INDEX `AdminFlowState_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BusinessConnection` ADD CONSTRAINT `BusinessConnection_businessAccountId_fkey` FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminBusinessAccount` ADD CONSTRAINT `AdminBusinessAccount_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminBusinessAccount` ADD CONSTRAINT `AdminBusinessAccount_businessAccountId_fkey` FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_businessAccountId_fkey` FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_businessAccountId_fkey` FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_businessConnectionId_fkey` FOREIGN KEY (`businessConnectionId`) REFERENCES `BusinessConnection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationJob` ADD CONSTRAINT `ConversationJob_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationJob` ADD CONSTRAINT `ConversationJob_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Handoff` ADD CONSTRAINT `Handoff_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KnowledgeItem` ADD CONSTRAINT `KnowledgeItem_businessAccountId_fkey` FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KnowledgeItem` ADD CONSTRAINT `KnowledgeItem_createdByAdminId_fkey` FOREIGN KEY (`createdByAdminId`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KnowledgeItem` ADD CONSTRAINT `KnowledgeItem_updatedByAdminId_fkey` FOREIGN KEY (`updatedByAdminId`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KnowledgeChunk` ADD CONSTRAINT `KnowledgeChunk_knowledgeItemId_fkey` FOREIGN KEY (`knowledgeItemId`) REFERENCES `KnowledgeItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IndexingJob` ADD CONSTRAINT `IndexingJob_knowledgeItemId_fkey` FOREIGN KEY (`knowledgeItemId`) REFERENCES `KnowledgeItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiDecisionLog` ADD CONSTRAINT `AiDecisionLog_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiDecisionLog` ADD CONSTRAINT `AiDecisionLog_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_businessAccountId_fkey` FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminFlowState` ADD CONSTRAINT `AdminFlowState_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
