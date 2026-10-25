import { prisma } from "./prisma.ts";
import { activeJob, latestJob, latestJobsFor } from "./jobs/jobs.ts";
import type { ProcessingJob } from "@prisma/client";
import type { SplitResultRecord } from "./jobs/handlers.ts";

// What the page-split screens know about a split: whether it is queued or running, how far it has got,
// and (once finished) where the result PDF is. All of it comes from the durable job record, so any
// process can answer, and a restart or a code reload can no longer lose a finished split.
export type SplitJobState = {
  status: "running" | "ready" | "failed";
  progress: { completed: number; total: number } | null;
  error?: string;
  resultStorageKey?: string;
  originalPageCount?: number;
  newPageCount?: number;
  splitOriginalPageNumbers?: number[];
};

export function splitStateOf(job: ProcessingJob | null | undefined): SplitJobState | undefined {
  if (!job) return undefined;
  if (job.state === "QUEUED" || job.state === "RUNNING") {
    return { status: "running", progress: job.progressTotal > 0 ? { completed: job.progressDone, total: job.progressTotal } : null };
  }
  if (job.state === "FAILED") return { status: "failed", progress: null, error: job.error ?? "Page split failed." };
  const result = (job.result ?? {}) as Partial<SplitResultRecord>;
  return { status: "ready", progress: null, ...result };
}

export async function getJob(versionId: string): Promise<SplitJobState | undefined> {
  return splitStateOf(await latestJob("page-split", versionId));
}

export async function getJobs(versionIds: string[]) {
  const jobs = await latestJobsFor("page-split", versionIds);
  return new Map(versionIds.map((id) => [id, splitStateOf(jobs.get(id))]));
}

export async function isJobRunning(versionId: string): Promise<boolean> {
  return Boolean(await activeJob("page-split", versionId));
}

export async function clearJob(versionId: string) {
  await prisma.processingJob.deleteMany({ where: { type: "page-split", subjectId: versionId } });
}
