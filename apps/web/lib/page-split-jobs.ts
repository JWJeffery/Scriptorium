import { deleteStorageFile, readStorageJson, safeStorageSegment, writeStorageJson } from "./server-storage.ts";

// In-memory Map for FAST, frequent progress updates while a job is
// actively running - this part really is fine to lose on a restart, the
// background job itself keeps running independently and will report its
// final state again once it finishes.
//
// The FINAL state (ready or failed) is different: it needs to still be
// there whenever the person gets around to clicking "Download" or
// "Create as new document", which might be well after the job finished.
// Originally this was in-memory only, matching OCR's own progress map -
// reasonable-seeming, since OCR's equivalent has worked fine. But it
// turned out not to be safe for THIS tool: confirmed directly, a
// completed split's in-memory record went missing before the person got
// to click "Download", while Next.js dev-mode Fast Refresh rebuilds were
// visibly happening in the browser console at the same time - dev mode
// can re-evaluate an API route's module (this one included) on a hot
// rebuild, which resets any module-level state like this Map, even
// though the underlying server process never restarted. So the final
// state is now ALSO written to a small JSON file on disk, right next to
// the actual result PDF, and read back from there as a fallback whenever
// the in-memory copy is missing - covering exactly the gap that caused
// the real failure, without needing a database migration for what's
// still meant to be a disposable, reviewable artifact (see
// pdf-page-splitter.ts's own note on why a split result was never meant
// to silently become the document's new working PDF).
export type SplitJobState = {
  status: "running" | "ready" | "failed";
  progress: { completed: number; total: number } | null;
  error?: string;
  resultStorageKey?: string;
  originalPageCount?: number;
  newPageCount?: number;
  splitOriginalPageNumbers?: number[];
};

const splitJobs = new Map<string, SplitJobState>();

function statusStorageKey(versionId: string) {
  const versionSegment = safeStorageSegment(versionId, "version");
  return `page-split-jobs/${versionSegment}/status.json`;
}

export function setRunningJob(versionId: string, progress: { completed: number; total: number } | null) {
  splitJobs.set(versionId, { status: "running", progress });
}

export async function setFinishedJob(versionId: string, state: SplitJobState) {
  splitJobs.set(versionId, state);
  // Only "ready" and "failed" get persisted - "running" is intentionally
  // never written to disk, so a stale in-progress record can't outlive
  // the process that would ever update it again.
  await writeStorageJson(statusStorageKey(versionId), state);
}

export async function getJob(versionId: string): Promise<SplitJobState | undefined> {
  const inMemory = splitJobs.get(versionId);
  if (inMemory) return inMemory;

  const persisted = await readStorageJson<SplitJobState>(statusStorageKey(versionId));
  if (!persisted) return undefined;

  // Found on disk but not in memory - the exact gap this was built to
  // cover. Warm the in-memory copy too, so the next lookup in this same
  // process doesn't need to hit disk again.
  splitJobs.set(versionId, persisted);
  return persisted;
}

export function isJobRunning(versionId: string): boolean {
  return splitJobs.get(versionId)?.status === "running";
}

export async function clearJob(versionId: string) {
  splitJobs.delete(versionId);
  await deleteStorageFile(statusStorageKey(versionId));
}
