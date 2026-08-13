ALTER TABLE `BusinessAiSettings`
  ALTER COLUMN `outsideHoursPolicy` SET DEFAULT 'QUEUE',
  ADD COLUMN `manualShutdownPolicy` VARCHAR(32) NOT NULL DEFAULT 'QUEUE',
  ADD COLUMN `backlogMaxAgeHours` INTEGER NOT NULL DEFAULT 24;

ALTER TABLE `BusinessAccount`
  ADD COLUMN `aiProcessingLeaseOwner` VARCHAR(64) NULL,
  ADD COLUMN `aiProcessingLeaseExpiresAt` DATETIME(3) NULL,
  ADD COLUMN `aiHourlyWindowStartedAt` DATETIME(3) NULL,
  ADD COLUMN `aiHourlyRequestCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `aiDailyWindowStartedAt` DATETIME(3) NULL,
  ADD COLUMN `aiDailyRequestCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `aiBlockedUntil` DATETIME(3) NULL;

CREATE INDEX `BusinessAccount_aiProcessingLeaseExpiresAt_idx`
  ON `BusinessAccount`(`aiProcessingLeaseExpiresAt`);
CREATE INDEX `BusinessAccount_aiBlockedUntil_idx` ON `BusinessAccount`(`aiBlockedUntil`);

ALTER TABLE `Customer`
  ADD COLUMN `aiHourlyWindowStartedAt` DATETIME(3) NULL,
  ADD COLUMN `aiHourlyRequestCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `aiDailyWindowStartedAt` DATETIME(3) NULL,
  ADD COLUMN `aiDailyRequestCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `aiBlockedUntil` DATETIME(3) NULL;

CREATE INDEX `Customer_aiBlockedUntil_idx` ON `Customer`(`aiBlockedUntil`);

ALTER TABLE `Message`
  MODIFY `processingStatus` ENUM(
    'NOT_APPLICABLE', 'PENDING', 'WAITING_FOR_AI_AVAILABILITY', 'READY', 'PROCESSING',
    'PROCESSED', 'SUPERSEDED', 'CANCELLED_BY_HUMAN', 'EXPIRED', 'FAILED'
  ) NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN `processingBatchId` CHAR(36) NULL;

ALTER TABLE `ConversationJob`
  MODIFY `status` ENUM(
    'NOT_APPLICABLE', 'PENDING', 'WAITING_FOR_AI_AVAILABILITY', 'READY', 'PROCESSING',
    'PROCESSED', 'SUPERSEDED', 'CANCELLED_BY_HUMAN', 'EXPIRED', 'FAILED'
  ) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `waitingReason` VARCHAR(64) NULL,
  ADD COLUMN `processingBatchId` CHAR(36) NULL;

CREATE INDEX `ConversationJob_conversationId_status_processAfter_idx`
  ON `ConversationJob`(`conversationId`, `status`, `processAfter`);

UPDATE `BusinessAiSettings` SET `outsideHoursPolicy` = 'QUEUE'
WHERE `outsideHoursPolicy` = 'SILENT';
