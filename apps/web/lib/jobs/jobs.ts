import type { ProcessingJob, ProcessingJobState } from "@prisma/client";
import { prisma } from "../prisma.ts";

// The durable, user-visible record of long-running work. The queue (pg-boss) decides who runs what and
// when; these rows say what each job is for, how far it has got, and how it ended. They are written by
// whichever process does the work and read by the web server, so progress is visible across processes.

export type JobType = "ocr" | "page-split" | "embed-index";
export const JOB_TYPES: readonly JobType[] = ["ocr", "page-split", "embed-index"];

// A failure retrying cannot fix (for example a timeout): record it and stop.
export class PermanentJobError extends Error {}

const ACTIVE: ProcessingJobState[] = ["QUEUED", "RUNNING"];

export async function createJob(type: JobType, subjectId: string) {
  return prisma.processingJob.create({ data: { type, subjectId } });
}

export async function activeJob(type: JobType, subjectId: string) {
  return prisma.processingJob.findFirst({ where: { type, subjectId, state: { in: ACTIVE } }, orderBy: { createdAt: "desc" } });
}

export async function latestJob(type: JobType, subjectId: string) {
  return prisma.processingJob.findFirst({ where: { type, subjectId }, orderBy: { createdAt: "desc" } });
}

// The newest job per subject, for lists that show many books at once.
export async function latestJobsFor(type: JobType, subjectIds: string[]) {
  if (subjectIds.length === 0) return new Map<string, ProcessingJob>();
  const rows = await prisma.processingJob.findMany({ where: { type, subjectId: { in: subjectIds } }, orderBy: { createdAt: "desc" } });
  const byId = new Map<string, ProcessingJob>();
  for (const row of rows) if (!byId.has(row.subjectId)) byId.set(row.subjectId, row);
  return byId;
}

export async function attachQueueId(jobId: string, queueJobId: string | null) {
  if (queueJobId) await prisma.processingJob.update({ where: { id: jobId }, data: { queueJobId } });
}

// False when the job is already finished (a repeated delivery after a crash): nothing more to do.
export async function markRunning(jobId: string) {
  const row = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!row || row.state === "COMPLETE") return null;
  return prisma.processingJob.update({
    where: { id: jobId },
    data: { state: "RUNNING", attempts: { increment: 1 }, startedAt: row.startedAt ?? new Date(), error: null, finishedAt: null }
  });
}

const lastProgressWrite = new Map<string, number>();

// Frequent callers (one call per page) are throttled to a few writes a second.
export async function reportProgress(jobId: string, done: number, total: number) {
  const now = Date.now();
  const finished = total > 0 && done >= total;
  if (!finished && now - (lastProgressWrite.get(jobId) ?? 0) < 400) return;
  lastProgressWrite.set(jobId, now);
  await prisma.processingJob.update({ where: { id: jobId }, data: { progressDone: done, progressTotal: total } }).catch(() => undefined);
}

export async function completeJob(jobId: string, result?: unknown) {
  lastProgressWrite.delete(jobId);
  await prisma.processingJob.update({
    where: { id: jobId },
    data: { state: "COMPLETE", finishedAt: new Date(), error: null, ...(result === undefined ? {} : { result: result as object }) }
  });
}

export async function failJob(jobId: string, message: string) {
  lastProgressWrite.delete(jobId);
  await prisma.processingJob.update({ where: { id: jobId }, data: { state: "FAILED", finishedAt: new Date(), error: message.slice(0, 2000) } });
}

// A failed attempt that will be tried again.
export async function requeueJob(jobId: string, message: string) {
  await prisma.processingJob.update({ where: { id: jobId }, data: { state: "QUEUED", error: message.slice(0, 2000) } });
}

export function summarizeJob(row: ProcessingJob) {
  return {
    id: row.id,
    type: row.type,
    subjectId: row.subjectId,
    state: row.state.toLowerCase(),
    progress: row.progressTotal > 0 ? { done: row.progressDone, total: row.progressTotal } : null,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  };
}
