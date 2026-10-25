-- Phase 1: durable record of long-running jobs (OCR, page split, meaning index).

-- CreateEnum
CREATE TYPE "ProcessingJobState" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "subjectId" VARCHAR(191) NOT NULL,
    "state" "ProcessingJobState" NOT NULL DEFAULT 'QUEUED',
    "progressDone" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "result" JSONB,
    "queueJobId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessingJob_type_subjectId_idx" ON "ProcessingJob"("type", "subjectId");

-- CreateIndex
CREATE INDEX "ProcessingJob_state_idx" ON "ProcessingJob"("state");

-- CreateIndex
CREATE INDEX "ProcessingJob_createdAt_idx" ON "ProcessingJob"("createdAt");
