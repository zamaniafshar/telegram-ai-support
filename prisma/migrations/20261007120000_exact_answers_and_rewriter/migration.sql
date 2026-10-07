-- CreateTable
CREATE TABLE `ExactAnswer` (
    `id` CHAR(36) NOT NULL,
    `businessAccountId` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdByAdminId` CHAR(36) NULL,
    `updatedByAdminId` CHAR(36) NULL,
    INDEX `ExactAnswer_businessAccountId_isActive_idx`(`businessAccountId`, `isActive`),
    INDEX `ExactAnswer_updatedByAdminId_idx`(`updatedByAdminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExactQuestion` (
    `id` CHAR(36) NOT NULL,
    `exactAnswerId` CHAR(36) NOT NULL,
    `questionText` VARCHAR(1000) NOT NULL,
    `qdrantPointId` VARCHAR(128) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ExactQuestion_qdrantPointId_key`(`qdrantPointId`),
    INDEX `ExactQuestion_exactAnswerId_isActive_idx`(`exactAnswerId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `AiDecisionLog`
    ADD COLUMN `wasRewritten` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `rewrittenQuery` TEXT NULL,
    ADD COLUMN `matchedExactQuestionId` CHAR(36) NULL,
    ADD COLUMN `exactMatchScore` DOUBLE NULL;

-- AddForeignKey
ALTER TABLE `ExactAnswer` ADD CONSTRAINT `ExactAnswer_businessAccountId_fkey` FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExactAnswer` ADD CONSTRAINT `ExactAnswer_createdByAdminId_fkey` FOREIGN KEY (`createdByAdminId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExactAnswer` ADD CONSTRAINT `ExactAnswer_updatedByAdminId_fkey` FOREIGN KEY (`updatedByAdminId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExactQuestion` ADD CONSTRAINT `ExactQuestion_exactAnswerId_fkey` FOREIGN KEY (`exactAnswerId`) REFERENCES `ExactAnswer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
