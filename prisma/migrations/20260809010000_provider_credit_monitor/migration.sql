-- CreateTable
CREATE TABLE `ProviderCreditMonitorState` (
    `id` VARCHAR(40) NOT NULL,
    `nextCheckAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseOwner` VARCHAR(64) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastBalanceUsd` DECIMAL(20, 8) NULL,
    `lastLowBalanceAlertAt` DATETIME(3) NULL,
    `lastInsufficientAlertAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProviderCreditMonitorState_nextCheckAt_leaseExpiresAt_idx`(`nextCheckAt`, `leaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
