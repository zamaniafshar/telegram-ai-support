ALTER TABLE `KnowledgeItem`
    DROP FOREIGN KEY `KnowledgeItem_createdByAdminId_fkey`,
    DROP FOREIGN KEY `KnowledgeItem_updatedByAdminId_fkey`;

ALTER TABLE `KnowledgeItem`
    MODIFY `createdByAdminId` CHAR(36) NULL,
    MODIFY `updatedByAdminId` CHAR(36) NULL;

ALTER TABLE `KnowledgeItem`
    ADD CONSTRAINT `KnowledgeItem_createdByAdminId_fkey`
        FOREIGN KEY (`createdByAdminId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `KnowledgeItem_updatedByAdminId_fkey`
        FOREIGN KEY (`updatedByAdminId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
