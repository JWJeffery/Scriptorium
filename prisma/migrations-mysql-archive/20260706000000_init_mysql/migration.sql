-- Initial MySQL schema for Scriptorium Milestone 1 and adjacent research models.
-- Generated manually from prisma/schema.prisma after the Spaceship/cPanel MySQL decision.

CREATE TABLE `Document` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(512) NOT NULL,
  `originalFilename` VARCHAR(512) NULL,
  `kind` ENUM('PDF', 'DOCX', 'OFFICE', 'GOOGLE_DOC', 'GOOGLE_SHEET', 'GOOGLE_SLIDE', 'TXT', 'MARKDOWN', 'OTHER') NOT NULL,
  `mediaType` VARCHAR(255) NULL,
  `storageKey` VARCHAR(1024) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `Document_title_idx` (`title`(191))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DocumentVersion` (
  `id` VARCHAR(191) NOT NULL,
  `documentId` VARCHAR(191) NOT NULL,
  `sourceChecksum` VARCHAR(255) NULL,
  `snapshotKind` ENUM('ORIGINAL', 'PDF_RENDERING', 'TEXT_EXTRACTION', 'HTML_RENDERING', 'IMAGE_SCAN') NOT NULL,
  `snapshotKey` VARCHAR(1024) NULL,
  `extractionState` VARCHAR(255) NOT NULL DEFAULT 'pending',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `DocumentVersion_documentId_idx` (`documentId`),
  CONSTRAINT `DocumentVersion_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Source` (
  `id` VARCHAR(191) NOT NULL,
  `documentId` VARCHAR(191) NULL,
  `shortTitle` VARCHAR(512) NULL,
  `cslJson` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `Source_documentId_idx` (`documentId`),
  CONSTRAINT `Source_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PageMap` (
  `id` VARCHAR(191) NOT NULL,
  `versionId` VARCHAR(191) NOT NULL,
  `pdfPageIndex` INTEGER NOT NULL,
  `visibleLabel` VARCHAR(64) NULL,
  `bookPageLabel` VARCHAR(64) NULL,
  `numberingSystem` ENUM('ARABIC', 'ROMAN', 'UNNUMBERED', 'APPENDIX', 'FOLIO', 'CUSTOM') NOT NULL DEFAULT 'ARABIC',
  `confidence` ENUM('IMPORTED', 'INFERRED', 'USER_CONFIRMED', 'UNCERTAIN') NOT NULL DEFAULT 'UNCERTAIN',
  `note` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PageMap_versionId_pdfPageIndex_key` (`versionId`, `pdfPageIndex`),
  INDEX `PageMap_bookPageLabel_idx` (`bookPageLabel`),
  CONSTRAINT `PageMap_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `DocumentVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TextSpan` (
  `id` VARCHAR(191) NOT NULL,
  `versionId` VARCHAR(191) NOT NULL,
  `pageMapId` VARCHAR(191) NULL,
  `text` LONGTEXT NOT NULL,
  `anchor` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `TextSpan_versionId_idx` (`versionId`),
  INDEX `TextSpan_pageMapId_idx` (`pageMapId`),
  CONSTRAINT `TextSpan_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `DocumentVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TextSpan_pageMapId_fkey` FOREIGN KEY (`pageMapId`) REFERENCES `PageMap`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Annotation` (
  `id` VARCHAR(191) NOT NULL,
  `documentId` VARCHAR(191) NOT NULL,
  `versionId` VARCHAR(191) NOT NULL,
  `pageMapId` VARCHAR(191) NULL,
  `colorKey` VARCHAR(64) NOT NULL,
  `selectedText` LONGTEXT NOT NULL,
  `note` LONGTEXT NULL,
  `anchor` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `Annotation_documentId_idx` (`documentId`),
  INDEX `Annotation_versionId_idx` (`versionId`),
  INDEX `Annotation_pageMapId_idx` (`pageMapId`),
  INDEX `Annotation_colorKey_idx` (`colorKey`),
  CONSTRAINT `Annotation_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Annotation_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `DocumentVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Annotation_pageMapId_fkey` FOREIGN KEY (`pageMapId`) REFERENCES `PageMap`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AnnotationTag` (
  `id` VARCHAR(191) NOT NULL,
  `annotationId` VARCHAR(191) NOT NULL,
  `value` VARCHAR(128) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AnnotationTag_annotationId_value_key` (`annotationId`, `value`),
  INDEX `AnnotationTag_value_idx` (`value`),
  CONSTRAINT `AnnotationTag_annotationId_fkey` FOREIGN KEY (`annotationId`) REFERENCES `Annotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Citation` (
  `id` VARCHAR(191) NOT NULL,
  `sourceId` VARCHAR(191) NOT NULL,
  `annotationId` VARCHAR(191) NULL,
  `styleId` VARCHAR(128) NOT NULL,
  `locale` VARCHAR(32) NOT NULL DEFAULT 'en-US',
  `locatorType` VARCHAR(64) NOT NULL DEFAULT 'page',
  `locatorValue` VARCHAR(255) NULL,
  `prefix` TEXT NULL,
  `suffix` TEXT NULL,
  `generatedText` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `Citation_sourceId_idx` (`sourceId`),
  INDEX `Citation_annotationId_idx` (`annotationId`),
  INDEX `Citation_styleId_idx` (`styleId`),
  CONSTRAINT `Citation_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `Source`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Citation_annotationId_fkey` FOREIGN KEY (`annotationId`) REFERENCES `Annotation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ResearchThread` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(512) NOT NULL,
  `description` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ResearchThreadTag` (
  `id` VARCHAR(191) NOT NULL,
  `researchThreadId` VARCHAR(191) NOT NULL,
  `value` VARCHAR(128) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ResearchThreadTag_researchThreadId_value_key` (`researchThreadId`, `value`),
  INDEX `ResearchThreadTag_value_idx` (`value`),
  CONSTRAINT `ResearchThreadTag_researchThreadId_fkey` FOREIGN KEY (`researchThreadId`) REFERENCES `ResearchThread`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ResearchThreadItem` (
  `id` VARCHAR(191) NOT NULL,
  `researchThreadId` VARCHAR(191) NOT NULL,
  `itemType` ENUM('DOCUMENT', 'ANNOTATION', 'CITATION', 'SOURCE', 'NOTE') NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `note` LONGTEXT NULL,
  `orderIndex` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `ResearchThreadItem_researchThreadId_idx` (`researchThreadId`),
  INDEX `ResearchThreadItem_itemType_itemId_idx` (`itemType`, `itemId`),
  CONSTRAINT `ResearchThreadItem_researchThreadId_fkey` FOREIGN KEY (`researchThreadId`) REFERENCES `ResearchThread`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `QueryLog` (
  `id` VARCHAR(191) NOT NULL,
  `query` LONGTEXT NOT NULL,
  `mode` VARCHAR(128) NOT NULL,
  `filters` JSON NULL,
  `resultIds` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
