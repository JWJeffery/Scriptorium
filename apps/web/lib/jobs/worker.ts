import type { PgBoss } from "pg-boss";
import { prisma } from "../prisma.ts";
import { acquireHeavyLock, type HeavyLock } from "../heavy-job-lock.ts";
import { ACTIVE_JOB_STATES, completeJob, failJob, failStaleJob, JobInterruptedError, markInterrupted, markRunning, PermanentJobError, requeueJob } from "./jobs.ts";
import { HEAVY_QUEUE, HEAVY_RETRY_LIMIT, checkQueueJob, getBoss, numberFromEnv, resendJob, type HeavyPayload } from "./queue.ts";

// Takes jobs off the queue and runs them, one at a time. Used by the standalone `pnpm worker` process
// and, in the default inline mode, by the web server itself.

// How often job records are checked against the queue (also once at start-up).
const RECONCILE_INTERVAL_MS = numberFromEnv("SCRIPTORIUM_JOB_RECONCILE_SECONDS", 300, 1) * 1000;
// How long stopWorker waits for the current job to save its work and return. The job is told to stop
// first, so normally this takes a few seconds; worker/main.ts exits after 45 s whatever happens, and
// docker-compose.prod.yml gives the container 60 s before it is killed.
const STOP_TIMEOUT_MS = 35_000;

type WorkerState = {
  started?: Promise<PgBoss>;
  current?: AbortController;
  stopping?: boolean;
  reconcileTimer?: ReturnType<typeof setInterval>;
};
const globalForWorker = globalThis as unknown as { scriptoriumWorker?: WorkerState };
const state = (globalForWorker.scriptoriumWorker ??= {});

// Job records that say QUEUED/RUNNING but have no live queue job behind them are either sent again
// (stopped on purpose by a shutdown) or marked FAILED, so they can be retried and never block new work.
export async function reconcileJobs(boss: PgBoss) {
  const rows = await prisma.processingJob.findMany({ where: { state: { in: [...ACTIVE_JOB_STATES] } }, orderBy: { createdAt: "asc" } });
  const outcome = { checked: rows.length, resumed: 0, failed: 0 };
  for (const row of rows) {
    try {
      const check = await checkQueueJob(boss, row);
      if (check.verdict === "resume") {
        await resendJob(boss, row);
        outcome.resumed += 1;
        console.log(`[jobs] ${row.type} ${row.subjectId}: queued again to continue after a restart`);
      } else if (check.verdict === "dead") {
        await failStaleJob(row, check.detail);
        outcome.failed += 1;
        console.warn(`[jobs] ${row.type} ${row.subjectId}: marked failed (${check.detail})`);
      }
    } catch (error) {
      console.error(`[jobs] could not check job ${row.id}:`, error);
    }
  }
  return outcome;
}

export function startWorker(): Promise<PgBoss> {
  state.started ??= (async () => {
    state.stopping = false;
    const boss = await getBoss("worker");
    await boss.work<HeavyPayload>(HEAVY_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
      const { jobId } = job.data;
      if (state.stopping) {
        // Fetched just as the worker began to stop: leave it for the next start.
        await markInterrupted(jobId);
        return;
      }
      const record = await markRunning(jobId);
      if (!record) return; // already finished: a repeated delivery after a crash
      const controller = new AbortController();
      state.current = controller;
      // Stops the job on shutdown (our controller) or when the queue gives up on it (expiry, lost claim).
      const signal = AbortSignal.any([controller.signal, job.signal]);
      let lock: HeavyLock | undefined;
      try {
        // Only one heavy task server-wide: wait here if a backup is running in the web server.
        lock = await acquireHeavyLock(`job:${record.type}`, { signal });
        // Loaded on first use so that starting the worker does not pull in the OCR and PDF libraries.
        const handlers = await import("./handlers.ts");
        const result = await handlers.runJob(record, { signal });
        await completeJob(jobId, result ?? undefined);
      } catch (error) {
        if (controller.signal.aborted && controller.signal.reason instanceof JobInterruptedError) {
          // Not a failure: the job saved its work; it is queued again when the worker next starts.
          await markInterrupted(jobId);
          console.log(`[jobs] ${record.type} ${record.subjectId} paused for shutdown; it continues after the restart`);
          return;
        }
        const message = error instanceof Error ? error.message : "The job failed.";
        const permanent = error instanceof PermanentJobError;
        if (permanent || job.retryCount >= HEAVY_RETRY_LIMIT) {
          await failJob(jobId, message);
        } else {
          await requeueJob(jobId, message);
        }
        console.error(`[jobs] ${record.type} ${record.subjectId} failed (attempt ${job.retryCount + 1}):`, error);
        if (!permanent) throw error; // lets the queue retry it
      } finally {
        if (state.current === controller) state.current = undefined;
        await lock?.release();
      }
    });
    const reconcile = () =>
      reconcileJobs(boss).catch((error) => console.error("[jobs] reconciliation failed:", error));
    await reconcile();
    state.reconcileTimer = setInterval(reconcile, RECONCILE_INTERVAL_MS);
    state.reconcileTimer.unref?.();
    console.log("[jobs] worker started");
    return boss;
  })();
  state.started.catch(() => {
    state.started = undefined;
  });
  return state.started;
}

// Graceful stop: the running job is told to stop at its next safe point (OCR saves the pages it has
// done and stops at the next page boundary), then the queue is closed.
export async function stopWorker() {
  const started = state.started;
  if (!started) return;
  state.stopping = true;
  if (state.reconcileTimer) clearInterval(state.reconcileTimer);
  state.current?.abort(new JobInterruptedError("The worker is shutting down."));
  const boss = await started;
  await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
  await prisma.$disconnect();
  state.started = undefined;
}
