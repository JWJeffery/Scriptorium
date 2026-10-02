-- CreateTable
CREATE TABLE `PassageEmbedding` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `pdfPage` INTEGER NULL,
    `startChar` INTEGER NOT NULL DEFAULT 0,
    `endChar` INTEGER NOT NULL DEFAULT 0,
    `textHash` VARCHAR(40) NOT NULL,
    `model` VARCHAR(64) NOT NULL,
    `vector` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PassageEmbedding_documentId_kind_idx`(`documentId`, `kind`),
    INDEX `PassageEmbedding_refId_idx`(`refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PassageEmbedding` ADD CONSTRAINT `PassageEmbedding_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
