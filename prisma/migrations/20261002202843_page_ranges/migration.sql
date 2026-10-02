-- CreateTable
CREATE TABLE `PageRange` (
    `id` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `startPdfPage` INTEGER NOT NULL,
    `endPdfPage` INTEGER NULL,
    `system` VARCHAR(32) NOT NULL,
    `startValue` INTEGER NOT NULL DEFAULT 1,
    `prefix` VARCHAR(16) NOT NULL DEFAULT '',
    `note` VARCHAR(255) NULL,

    INDEX `PageRange_versionId_startPdfPage_idx`(`versionId`, `startPdfPage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PageRange` ADD CONSTRAINT `PageRange_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `DocumentVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
