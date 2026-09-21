-- CreateEnum
-- SystemLogLevel / SystemLogCategory are created inline as ENUM in MySQL

-- CreateTable
CREATE TABLE `SystemLog` (
    `id` CHAR(36) NOT NULL,
    `businessAccountId` CHAR(36) NULL,
    `level` ENUM('TRACE','DEBUG','INFO','WARN','ERROR','FATAL') NOT NULL,
    `category` ENUM('WEBHOOK','TELEGRAM','AI','RETRIEVAL','INDEXING','QDRANT','WORKER','HANDOFF','AUTH','SYSTEM','CREDIT','DATABASE','HTTP') NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `messageFa` VARCHAR(500) NOT NULL,
    `errorCode` VARCHAR(100) NULL,
    `correlationId` VARCHAR(64) NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `SystemLog_businessAccountId_createdAt_idx`(`businessAccountId`, `createdAt`),
    INDEX `SystemLog_level_createdAt_idx`(`level`, `createdAt`),
    INDEX `SystemLog_category_createdAt_idx`(`category`, `createdAt`),
    INDEX `SystemLog_fingerprint_createdAt_idx`(`fingerprint`, `createdAt`),
    INDEX `SystemLog_errorCode_createdAt_idx`(`errorCode`, `createdAt`),
    INDEX `SystemLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SystemLog` ADD CONSTRAINT `SystemLog_businessAccountId_fkey` FOREIGN KEY (`businessAccountId`) REFERENCES `BusinessAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
