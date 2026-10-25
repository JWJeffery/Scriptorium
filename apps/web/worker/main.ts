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
  console.log(`[jobs] ${signal} received; finishing the current job before stopping...`);
  await stopWorker().catch((error) => console.error("[jobs] error while stopping:", error));
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
