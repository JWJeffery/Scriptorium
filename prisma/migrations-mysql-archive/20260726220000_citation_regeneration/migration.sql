-- Citation regeneration lineage (Milestone 14).
-- Adds staleness tracking (sourceSnapshotUpdatedAt) and a self-referencing
-- "supersedes" pointer so regenerating a citation creates a new row rather
-- than mutating history, per ARCHITECTURE.md's regeneration rule.

ALTER TABLE `Citation`
  ADD COLUMN `sourceSnapshotUpdatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `supersedesCitationId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Citation_supersedesCitationId_key` ON `Citation`(`supersedesCitationId`);

ALTER TABLE `Citation`
  ADD CONSTRAINT `Citation_supersedesCitationId_fkey`
    FOREIGN KEY (`supersedesCitationId`) REFERENCES `Citation`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
