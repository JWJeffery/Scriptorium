// The standalone worker: `pnpm worker`. Runs queued OCR, page-split and indexing jobs, one at a time.
// Use it with SCRIPTORIUM_WORKER_MODE=external on the web server so the two never both work the queue.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Settings from the repository's .env, for anything not already in the environment.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n#]*?)"?\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
process.env.SCRIPTORIUM_WORKER_MODE = "external";

const { startWorker, stopWorker } = await import("../lib/jobs/worker.ts");
await startWorker();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[jobs] ${signal} received; saving the current job's progress and stopping...`);
  // The current job stops at its next safe point (OCR: the next page, after saving what it has done) and
  // continues after the restart. Never take longer than 45 s: docker-compose.prod.yml allows 60 s before
  // it kills the container, and a job cut off even then still resumes from its last saved batch.
  setTimeout(() => {
    console.error("[jobs] the current job did not stop within 45 s; exiting anyway.");
    process.exit(1);
  }, 45_000).unref();
  await stopWorker().catch((error) => console.error("[jobs] error while stopping:", error));
  console.log("[jobs] worker stopped");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
