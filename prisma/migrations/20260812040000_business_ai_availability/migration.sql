-- Business-wide AI availability settings. Existing businesses remain 24/7 enabled
-- through the application default until their first settings read/write creates a row.
CREATE TABLE `BusinessAiSettings` (
    `id` CHAR(36) NOT NULL,
    `businessAccountId` CHAR(36) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Tehran',
    `weeklySchedule` JSON NOT NULL,
    `outsideHoursPolicy` VARCHAR(32) NOT NULL DEFAULT 'SILENT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `lastChangeReason` VARCHAR(500) NULL,
    `updatedByAdminId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BusinessAiSettings_businessAccountId_key`(`businessAccountId`),
    INDEX `BusinessAiSettings_enabled_idx`(`enabled`),
    INDEX `BusinessAiSettings_updatedByAdminId_idx`(`updatedByAdminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BusinessAiSettings`
    ADD CONSTRAINT `BusinessAiSettings_businessAccountId_fkey`
    FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `BusinessAiSettings`
    ADD CONSTRAINT `BusinessAiSettings_updatedByAdminId_fkey`
    FOREIGN KEY (`updatedByAdminId`) REFERENCES `Admin`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
