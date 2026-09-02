-- CreateTable
CREATE TABLE `HostResourceMonitorState` (
    `id` VARCHAR(40) NOT NULL,
    `nextCheckAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseOwner` VARCHAR(64) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `cpuPercent` DOUBLE NOT NULL DEFAULT 0,
    `memoryPercent` DOUBLE NOT NULL DEFAULT 0,
    `memoryUsedMb` INTEGER NOT NULL DEFAULT 0,
    `memoryTotalMb` INTEGER NOT NULL DEFAULT 0,
    `processMemoryMb` INTEGER NOT NULL DEFAULT 0,
    `highUsageStartedAt` DATETIME(3) NULL,
    `continuousHighUsageMinutes` INTEGER NOT NULL DEFAULT 0,
    `isOverloaded` BOOLEAN NOT NULL DEFAULT false,
    `lastOverloadAlertAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `HostResourceMonitorState_nextCheckAt_leaseExpiresAt_idx`(`nextCheckAt`, `leaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
