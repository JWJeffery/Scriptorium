import { PgBoss } from "pg-boss";
import { activeJob, attachQueueId, createJob, type JobType } from "./jobs.ts";

// All long jobs go through ONE queue worked one-at-a-time, so a small server is never asked to run two
// heavy jobs at once (a second request simply waits its turn).
//
// Where the work runs is chosen by SCRIPTORIUM_WORKER_MODE:
//   inline   (default) the web server also runs the worker. One command (`pnpm dev`) is enough.
//   external           the web server only queues jobs; run `pnpm worker` as its own process.
export const HEAVY_QUEUE = "heavy";
export const HEAVY_RETRY_LIMIT = 1;

export type HeavyPayload = { jobId: string };
export type BossRole = "worker" | "sender";

export const workerMode = (): "inline" | "external" => (process.env.SCRIPTORIUM_WORKER_MODE === "external" ? "external" : "inline");

const numberFromEnv = (name: string, fallback: number, min: number) => Math.max(min, Number(process.env[name]) || fallback);

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
      // The longest legitimate job (OCR of a long book) is bounded well below this.
      expireInSeconds: 3600,
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

// Queue a long job and return its durable record. If the same work is already queued or running, return that.
export async function enqueueHeavyJob(type: JobType, subjectId: string) {
  const running = await activeJob(type, subjectId);
  if (running) return { job: running, alreadyActive: true };
  if (workerMode() === "inline") {
    const { startWorker } = await import("./worker.ts");
    await startWorker();
  }
  const boss = await getBoss(workerMode() === "inline" ? "worker" : "sender");
  const job = await createJob(type, subjectId);
  const queueJobId = await boss.send(HEAVY_QUEUE, { jobId: job.id } satisfies HeavyPayload);
  await attachQueueId(job.id, queueJobId);
  return { job, alreadyActive: false };
}
