import type { PgBoss } from "pg-boss";
import { prisma } from "../prisma.ts";
import { completeJob, failJob, markRunning, PermanentJobError, requeueJob } from "./jobs.ts";
import { HEAVY_QUEUE, HEAVY_RETRY_LIMIT, getBoss, type HeavyPayload } from "./queue.ts";

// Takes jobs off the queue and runs them, one at a time. Used by the standalone `pnpm worker` process
// and, in the default inline mode, by the web server itself.

const globalForWorker = globalThis as unknown as { scriptoriumWorker?: Promise<PgBoss> };

export function startWorker(): Promise<PgBoss> {
  globalForWorker.scriptoriumWorker ??= (async () => {
    const boss = await getBoss("worker");
    await boss.work<HeavyPayload>(HEAVY_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
      const { jobId } = job.data;
      const record = await markRunning(jobId);
      if (!record) return; // already finished: a repeated delivery after a crash
      try {
        // Loaded on first use so that starting the worker does not pull in the OCR and PDF libraries.
        const handlers = await import("./handlers.ts");
        const result = await handlers.runJob(record);
        await completeJob(jobId, result ?? undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The job failed.";
        const permanent = error instanceof PermanentJobError;
        if (permanent || job.retryCount >= HEAVY_RETRY_LIMIT) {
          await failJob(jobId, message);
        } else {
          await requeueJob(jobId, message);
        }
        console.error(`[jobs] ${record.type} ${record.subjectId} failed (attempt ${job.retryCount + 1}):`, error);
        if (!permanent) throw error; // lets the queue retry it
      }
    });
    console.log("[jobs] worker started");
    return boss;
  })();
  globalForWorker.scriptoriumWorker.catch(() => {
    globalForWorker.scriptoriumWorker = undefined;
  });
  return globalForWorker.scriptoriumWorker;
}

export async function stopWorker() {
  const started = globalForWorker.scriptoriumWorker;
  if (!started) return;
  const boss = await started;
  await boss.stop({ graceful: true, timeout: 30_000 });
  await prisma.$disconnect();
  globalForWorker.scriptoriumWorker = undefined;
}
