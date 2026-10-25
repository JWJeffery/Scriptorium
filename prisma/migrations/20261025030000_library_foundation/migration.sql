-- Phase 1: library foundation. Adds workflow state, progress, soft deletion, item tags, collections and saved searches.
-- Additive only: existing Document columns, ids and rows are untouched.

-- CreateEnum
CREATE TYPE "ItemWorkflowState" AS ENUM ('READ_LATER', 'READING', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "favorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastOpenedAt" TIMESTAMP(3),
ADD COLUMN     "lastPage" INTEGER,
ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workflowState" "ItemWorkflowState" NOT NULL DEFAULT 'READ_LATER';

-- CreateTable
CREATE TABLE "DocumentTag" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "value" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCollection" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "query" JSONB NOT NULL,
    "sort" VARCHAR(64) NOT NULL DEFAULT 'recent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentTag_value_idx" ON "DocumentTag"("value");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTag_documentId_value_key" ON "DocumentTag"("documentId", "value");

-- CreateIndex
CREATE INDEX "Collection_parentId_idx" ON "Collection"("parentId");

-- CreateIndex
CREATE INDEX "ItemCollection_collectionId_idx" ON "ItemCollection"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCollection_documentId_collectionId_key" ON "ItemCollection"("documentId", "collectionId");

-- CreateIndex
CREATE INDEX "Document_workflowState_idx" ON "Document"("workflowState");

-- CreateIndex
CREATE INDEX "Document_deletedAt_idx" ON "Document"("deletedAt");

-- AddForeignKey
ALTER TABLE "DocumentTag" ADD CONSTRAINT "DocumentTag_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCollection" ADD CONSTRAINT "ItemCollection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCollection" ADD CONSTRAINT "ItemCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: books that already carry annotations are in active use, so they start as "Reading".
UPDATE "Document" SET "workflowState" = 'READING' WHERE id IN (SELECT DISTINCT "documentId" FROM "Annotation");
-- Accepted date for existing rows is when they were created.
UPDATE "Document" SET "acceptedAt" = "createdAt";
