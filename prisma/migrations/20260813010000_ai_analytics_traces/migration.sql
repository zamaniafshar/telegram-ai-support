ALTER TABLE `AiDecisionLog`
  ADD COLUMN `businessAccountId` CHAR(36) NULL,
  ADD COLUMN `decision` VARCHAR(40) NULL,
  ADD COLUMN `rawRetrievalResults` JSON NULL,
  ADD COLUMN `validatedRetrievalResults` JSON NULL,
  ADD COLUMN `knowledgeSentToAi` JSON NULL,
  ADD COLUMN `messageBatch` JSON NULL,
  ADD COLUMN `conversationContext` JSON NULL,
  ADD COLUMN `outcome` ENUM('PROCESSING', 'SENT', 'HANDOFF', 'SUPPRESSED', 'WAITING', 'FAILED') NOT NULL DEFAULT 'PROCESSING',
  ADD COLUMN `outcomeReason` VARCHAR(120) NULL,
  ADD COLUMN `topRetrievalScore` DOUBLE NULL,
  ADD COLUMN `retrievalLatencyMs` INTEGER NULL,
  ADD COLUMN `totalLatencyMs` INTEGER NULL,
  ADD COLUMN `completedAt` DATETIME(3) NULL,
  ADD COLUMN `expiresAt` DATETIME(3) NULL;

UPDATE `AiDecisionLog` AS trace
INNER JOIN `Conversation` AS conversation ON conversation.`id` = trace.`conversationId`
SET trace.`businessAccountId` = conversation.`businessAccountId`,
    trace.`decision` = IF(trace.`answerable`, 'GROUNDED_ANSWER', 'HANDOFF'),
    trace.`rawRetrievalResults` = trace.`retrievalResults`,
    trace.`validatedRetrievalResults` = trace.`retrievalResults`,
    trace.`knowledgeSentToAi` = trace.`retrievalResults`,
    trace.`messageBatch` = JSON_ARRAY(),
    trace.`conversationContext` = JSON_ARRAY(),
    trace.`outcome` = IF(trace.`answerable`, 'SENT', 'HANDOFF'),
    trace.`completedAt` = trace.`createdAt`,
    trace.`expiresAt` = DATE_ADD(trace.`createdAt`, INTERVAL 90 DAY);

ALTER TABLE `AiDecisionLog`
  MODIFY `businessAccountId` CHAR(36) NOT NULL,
  MODIFY `answerable` BOOLEAN NULL,
  MODIFY `confidence` DOUBLE NULL,
  MODIFY `reason` TEXT NULL,
  MODIFY `rawRetrievalResults` JSON NOT NULL,
  MODIFY `validatedRetrievalResults` JSON NOT NULL,
  MODIFY `knowledgeSentToAi` JSON NOT NULL,
  MODIFY `messageBatch` JSON NOT NULL,
  MODIFY `conversationContext` JSON NOT NULL,
  MODIFY `model` VARCHAR(100) NULL,
  MODIFY `expiresAt` DATETIME(3) NOT NULL,
  ADD INDEX `AiDecisionLog_businessAccountId_createdAt_idx` (`businessAccountId`, `createdAt`),
  ADD INDEX `AiDecisionLog_businessAccountId_outcome_createdAt_idx` (`businessAccountId`, `outcome`, `createdAt`),
  ADD INDEX `AiDecisionLog_expiresAt_idx` (`expiresAt`),
  ADD CONSTRAINT `AiDecisionLog_businessAccountId_fkey`
    FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
