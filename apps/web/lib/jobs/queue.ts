import { Prisma, type ProcessingJob } from "@prisma/client";
import { PgBoss } from "pg-boss";
import { prisma } from "../prisma.ts";
import { activeJob, attachQueueId, createJob, failStaleJob, isAwaitingResume, type JobType } from "./jobs.ts";

// All long jobs go through ONE queue worked one-at-a-time, so a small server is never asked to run two
// heavy jobs at once (a second request simply waits its turn). Backups, which run in the web server,
// share a database-wide lock with these jobs (see lib/heavy-job-lock.ts).
//
// Where the work runs is chosen by SCRIPTORIUM_WORKER_MODE:
//   inline   (default) the web server also runs the worker. One command (`pnpm dev`) is enough.
//   external           the web server only queues jobs; run `pnpm worker` as its own process.
export const HEAVY_QUEUE = "heavy";
export const HEAVY_RETRY_LIMIT = 1;

// How long one attempt may stay "active" before the queue gives up on it. Each job enforces its own,
// shorter limit (OCR: lib/jobs/handlers.ts, at most 10 hours; page split: lib/pdf-page-splitter.ts), so
// this is only a backstop for a worker that is alive but stuck. A worker that dies is noticed much
// sooner, through the heartbeat below. pg-boss allows at most 24 hours.
export const HEAVY_EXPIRE_SECONDS = 12 * 3600;

export type HeavyPayload = { jobId: string };
export type BossRole = "worker" | "sender";

export const workerMode = (): "inline" | "external" => (process.env.SCRIPTORIUM_WORKER_MODE === "external" ? "external" : "inline");

export const numberFromEnv = (name: string, fallback: number, min: number) => Math.max(min, Number(process.env[name]) || fallback);

// pg-boss keeps its tables in its own "pgboss" schema in the same database. Prisma's "?schema=" URL
// parameter means nothing to the pg driver, so drop it.
function connectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return url.replace(/([?&])schema=[^&]*&?/, "$1").replace(/[?&]$/, "");
}

const globalForBoss = globalThis as unknown as { scriptoriumBoss?: { role: BossRole; ready: Promise<PgBoss> } };

export function getBoss(role: BossRole): Promise<PgBoss> {
  const existing = globalForBoss.scriptoriumBoss;
  if (existing && (existing.role === "worker" || role === "sender")) return existing.ready;

  const isWorker = role === "worker";
  const boss = new PgBoss({
    connectionString: connectionString(),
    application_name: isWorker ? "scriptorium-worker" : "scriptorium-web",
    // A sender only adds jobs; the process that works them also supervises (expires and retries dead jobs).
    supervise: isWorker,
    schedule: false,
    superviseIntervalSeconds: numberFromEnv("SCRIPTORIUM_JOB_SUPERVISE_SECONDS", 30, 1),
    max: isWorker ? 4 : 2
  });
  boss.on("error", (error) => console.error("[jobs] queue error:", error));
  const ready = (async () => {
    await boss.start();
    const queueOptions = {
      retryLimit: HEAVY_RETRY_LIMIT,
      retryDelay: 5,
      expireInSeconds: HEAVY_EXPIRE_SECONDS,
      // A worker that dies without finishing is noticed after this long and its job retried.
      heartbeatSeconds: numberFromEnv("SCRIPTORIUM_JOB_HEARTBEAT_SECONDS", 60, 10),
      deleteAfterSeconds: 24 * 3600,
      retentionSeconds: 7 * 24 * 3600
    };
    await boss.createQueue(HEAVY_QUEUE, queueOptions);
    // createQueue leaves an existing queue alone, so re-apply the current settings every time a worker starts.
    if (isWorker) await boss.updateQueue(HEAVY_QUEUE, queueOptions);
    return boss;
  })();
  ready.catch(() => {
    if (globalForBoss.scriptoriumBoss?.ready === ready) globalForBoss.scriptoriumBoss = undefined;
  });
  globalForBoss.scriptoriumBoss = { role, ready };
  return ready;
}

// Queue states in which pg-boss will still run (or is running) the job.
const LIVE_QUEUE_STATES = new Set(["created", "retry", "active"]);
// A record is created a moment before its queue job; give that moment plenty of room.
const UNQUEUED_GRACE_MS = 10 * 60 * 1000;

export type QueueVerdict = { verdict: "live" } | { verdict: "resume" } | { verdict: "dead"; detail: string };

// Does this QUEUED/RUNNING record still have a queue job that will run it?
export async function checkQueueJob(boss: PgBoss, row: ProcessingJob): Promise<QueueVerdict> {
  if (!row.queueJobId) {
    if (Date.now() - row.createdAt.getTime() < UNQUEUED_GRACE_MS) return { verdict: "live" };
    return isAwaitingResume(row) ? { verdict: "resume" } : { verdict: "dead", detail: "it never reached the job queue" };
  }
  const queued = await boss.getJobById(HEAVY_QUEUE, row.queueJobId);
  if (queued && LIVE_QUEUE_STATES.has(queued.state)) return { verdict: "live" };
  // Stopped on purpose by a worker shutdown: its queue job ended normally and it waits to be sent again.
  if (isAwaitingResume(row)) return { verdict: "resume" };
  if (!queued) return { verdict: "dead", detail: "the job queue no longer has it" };
  return { verdict: "dead", detail: `the job queue reports it as ${queued.state}` };
}

// Queue a fresh delivery for a record a worker shutdown interrupted. Its saved progress is kept.
export async function resendJob(boss: PgBoss, row: ProcessingJob) {
  const queueJobId = await boss.send(HEAVY_QUEUE, { jobId: row.id } satisfies HeavyPayload);
  await prisma.processingJob.update({ where: { id: row.id }, data: { queueJobId, result: Prisma.DbNull, error: null } });
  return queueJobId;
}

// Queue a long job and return its durable record. If the same work is already queued or running, return that.
export async function enqueueHeavyJob(type: JobType, subjectId: string) {
  if (workerMode() === "inline") {
    const { startWorker } = await import("./worker.ts");
    await startWorker();
  }
  const boss = await getBoss(workerMode() === "inline" ? "worker" : "sender");
  const running = await activeJob(type, subjectId);
  if (running) {
    const check = await checkQueueJob(boss, running);
    if (check.verdict !== "dead") return { job: running, alreadyActive: true };
    // A stuck record must not block the same work for ever.
    await failStaleJob(running, check.detail, { replaced: true });
  }
  const job = await createJob(type, subjectId);
  const queueJobId = await boss.send(HEAVY_QUEUE, { jobId: job.id } satisfies HeavyPayload);
  await attachQueueId(job.id, queueJobId);
  return { job, alreadyActive: false };
}
