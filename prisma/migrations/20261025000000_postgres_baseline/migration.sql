-- Phase 1 baseline for PostgreSQL. The earlier MySQL history is archived in prisma/migrations-mysql-archive.
-- pgvector is enabled now; the embedding tables move to vector columns in a later phase.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PDF', 'DOCX', 'OFFICE', 'GOOGLE_DOC', 'GOOGLE_SHEET', 'GOOGLE_SLIDE', 'TXT', 'MARKDOWN', 'OTHER');

-- CreateEnum
CREATE TYPE "SnapshotKind" AS ENUM ('ORIGINAL', 'PDF_RENDERING', 'TEXT_EXTRACTION', 'HTML_RENDERING', 'IMAGE_SCAN');

-- CreateEnum
CREATE TYPE "PageNumberingSystem" AS ENUM ('ARABIC', 'ROMAN', 'UNNUMBERED', 'APPENDIX', 'FOLIO', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MappingConfidence" AS ENUM ('IMPORTED', 'INFERRED', 'USER_CONFIRMED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "ResearchThreadItemType" AS ENUM ('DOCUMENT', 'ANNOTATION', 'CITATION', 'SOURCE', 'NOTE');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "originalFilename" VARCHAR(512),
    "kind" "DocumentKind" NOT NULL,
    "mediaType" VARCHAR(255),
    "storageKey" VARCHAR(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceChecksum" VARCHAR(255),
    "snapshotKind" "SnapshotKind" NOT NULL,
    "snapshotKey" VARCHAR(1024),
    "extractionState" VARCHAR(255) NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "shortTitle" VARCHAR(512),
    "cslJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageMap" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "pdfPageIndex" INTEGER NOT NULL,
    "visibleLabel" VARCHAR(64),
    "bookPageLabel" VARCHAR(64),
    "numberingSystem" "PageNumberingSystem" NOT NULL DEFAULT 'ARABIC',
    "confidence" "MappingConfidence" NOT NULL DEFAULT 'UNCERTAIN',
    "note" TEXT,

    CONSTRAINT "PageMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassageEmbedding" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "refId" VARCHAR(191) NOT NULL,
    "pdfPage" INTEGER,
    "startChar" INTEGER NOT NULL DEFAULT 0,
    "endChar" INTEGER NOT NULL DEFAULT 0,
    "textHash" VARCHAR(40) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "vector" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassageEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pdfPage" INTEGER NOT NULL,
    "label" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageRange" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "startPdfPage" INTEGER NOT NULL,
    "endPdfPage" INTEGER,
    "system" VARCHAR(32) NOT NULL,
    "startValue" INTEGER NOT NULL DEFAULT 1,
    "prefix" VARCHAR(16) NOT NULL DEFAULT '',
    "note" VARCHAR(255),

    CONSTRAINT "PageRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextSpan" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "pageMapId" TEXT,
    "text" TEXT NOT NULL,
    "anchor" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TextSpan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "pageMapId" TEXT,
    "colorKey" VARCHAR(64) NOT NULL,
    "selectedText" TEXT NOT NULL,
    "note" TEXT,
    "anchor" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnotationTag" (
    "id" TEXT NOT NULL,
    "annotationId" TEXT NOT NULL,
    "value" VARCHAR(128) NOT NULL,

    CONSTRAINT "AnnotationTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "annotationId" TEXT,
    "styleId" VARCHAR(128) NOT NULL,
    "locale" VARCHAR(32) NOT NULL DEFAULT 'en-US',
    "locatorType" VARCHAR(64) NOT NULL DEFAULT 'page',
    "locatorValue" VARCHAR(255),
    "prefix" TEXT,
    "suffix" TEXT,
    "generatedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceSnapshotUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesCitationId" TEXT,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchThread" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchThreadTag" (
    "id" TEXT NOT NULL,
    "researchThreadId" TEXT NOT NULL,
    "value" VARCHAR(128) NOT NULL,

    CONSTRAINT "ResearchThreadTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchThreadItem" (
    "id" TEXT NOT NULL,
    "researchThreadId" TEXT NOT NULL,
    "itemType" "ResearchThreadItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "note" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ResearchThreadItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryLog" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "mode" VARCHAR(128) NOT NULL,
    "filters" JSONB,
    "resultIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_title_idx" ON "Document"("title");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");

-- CreateIndex
CREATE INDEX "Source_documentId_idx" ON "Source"("documentId");

-- CreateIndex
CREATE INDEX "PageMap_bookPageLabel_idx" ON "PageMap"("bookPageLabel");

-- CreateIndex
CREATE UNIQUE INDEX "PageMap_versionId_pdfPageIndex_key" ON "PageMap"("versionId", "pdfPageIndex");

-- CreateIndex
CREATE INDEX "PassageEmbedding_documentId_kind_idx" ON "PassageEmbedding"("documentId", "kind");

-- CreateIndex
CREATE INDEX "PassageEmbedding_refId_idx" ON "PassageEmbedding"("refId");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_documentId_pdfPage_key" ON "Bookmark"("documentId", "pdfPage");

-- CreateIndex
CREATE INDEX "PageRange_versionId_startPdfPage_idx" ON "PageRange"("versionId", "startPdfPage");

-- CreateIndex
CREATE INDEX "TextSpan_versionId_idx" ON "TextSpan"("versionId");

-- CreateIndex
CREATE INDEX "TextSpan_pageMapId_idx" ON "TextSpan"("pageMapId");

-- CreateIndex
CREATE INDEX "Annotation_documentId_idx" ON "Annotation"("documentId");

-- CreateIndex
CREATE INDEX "Annotation_versionId_idx" ON "Annotation"("versionId");

-- CreateIndex
CREATE INDEX "Annotation_pageMapId_idx" ON "Annotation"("pageMapId");

-- CreateIndex
CREATE INDEX "Annotation_colorKey_idx" ON "Annotation"("colorKey");

-- CreateIndex
CREATE INDEX "AnnotationTag_value_idx" ON "AnnotationTag"("value");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationTag_annotationId_value_key" ON "AnnotationTag"("annotationId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Citation_supersedesCitationId_key" ON "Citation"("supersedesCitationId");

-- CreateIndex
CREATE INDEX "Citation_sourceId_idx" ON "Citation"("sourceId");

-- CreateIndex
CREATE INDEX "Citation_annotationId_idx" ON "Citation"("annotationId");

-- CreateIndex
CREATE INDEX "Citation_styleId_idx" ON "Citation"("styleId");

-- CreateIndex
CREATE INDEX "ResearchThreadTag_value_idx" ON "ResearchThreadTag"("value");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchThreadTag_researchThreadId_value_key" ON "ResearchThreadTag"("researchThreadId", "value");

-- CreateIndex
CREATE INDEX "ResearchThreadItem_researchThreadId_idx" ON "ResearchThreadItem"("researchThreadId");

-- CreateIndex
CREATE INDEX "ResearchThreadItem_itemType_itemId_idx" ON "ResearchThreadItem"("itemType", "itemId");

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageMap" ADD CONSTRAINT "PageMap_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassageEmbedding" ADD CONSTRAINT "PassageEmbedding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRange" ADD CONSTRAINT "PageRange_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextSpan" ADD CONSTRAINT "TextSpan_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextSpan" ADD CONSTRAINT "TextSpan_pageMapId_fkey" FOREIGN KEY ("pageMapId") REFERENCES "PageMap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_pageMapId_fkey" FOREIGN KEY ("pageMapId") REFERENCES "PageMap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnotationTag" ADD CONSTRAINT "AnnotationTag_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "Annotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "Annotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_supersedesCitationId_fkey" FOREIGN KEY ("supersedesCitationId") REFERENCES "Citation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchThreadTag" ADD CONSTRAINT "ResearchThreadTag_researchThreadId_fkey" FOREIGN KEY ("researchThreadId") REFERENCES "ResearchThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchThreadItem" ADD CONSTRAINT "ResearchThreadItem_researchThreadId_fkey" FOREIGN KEY ("researchThreadId") REFERENCES "ResearchThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
