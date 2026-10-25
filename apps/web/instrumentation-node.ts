import { startWorker } from "./lib/jobs/worker";

// In the default "inline" worker mode the web server also works the job queue, so a single `pnpm dev` or
// `next start` runs everything. With SCRIPTORIUM_WORKER_MODE=external a separate `pnpm worker` does it instead.
if (process.env.SCRIPTORIUM_WORKER_MODE !== "external" && process.env.DATABASE_URL) {
  startWorker().catch((error) => console.error("[jobs] the worker could not start:", error));
}
