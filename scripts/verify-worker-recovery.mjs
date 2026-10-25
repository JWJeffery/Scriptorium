// Proves the worker really is separate and really is durable. It starts a web server in "external" mode
// (which only queues jobs) and a standalone worker process, then:
//   1. with no worker running, a queued job simply waits;
//   2. a worker picks it up and reports live progress;
//   3. the worker is killed (SIGKILL: no chance to clean up) in the middle of the job;
//   4. a replacement worker notices the dead one, retries the job, and finishes it.
// Needs a built app and a migrated database. Uses its own ports and short heartbeat/supervise timers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spreadPdf } from "./lib-test-pdf.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "apps/web");
const port = Number(process.env.SCRIPTORIUM_RECOVERY_PORT ?? 3200);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const env = {
  ...process.env,
  SCRIPTORIUM_WORKER_MODE: "external",
  SCRIPTORIUM_AUTH_DISABLED: "true",
  SCRIPTORIUM_RATE_LIMITS_DISABLED: "true",
  SCRIPTORIUM_FAKE_EMBEDDINGS: "1",
  SCRIPTORIUM_JOB_HEARTBEAT_SECONDS: "10",
  SCRIPTORIUM_JOB_SUPERVISE_SECONDS: "3"
};

const children = [];
function start(name, command, args, extra = {}) {
  // Own process group, so a kill reaches the real worker that tsx starts as a child, not just tsx.
  const child = spawn(command, args, { cwd: webDir, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk; });
  child.stderr.on("data", (chunk) => { child.output += chunk; });
  child.exited = new Promise((resolve) => child.on("exit", resolve));
  children.push(child);
  child.label = name;
  return child;
}
const startWorker = () => start("worker", "node", ["node_modules/tsx/dist/cli.mjs", "worker/main.ts"]);
const killGroup = (child, signal) => { try { process.kill(-child.pid, signal); } catch { /* already gone */ } };
const cleanup = () => { for (const child of children) killGroup(child, "SIGKILL"); };
process.on("exit", cleanup);

const call = async (path, init) => {
  const response = await fetch(`${base}${path}`, init);
  return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
};

try {
  const server = start("web", "node", ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)]);
  for (let i = 0; i < 60; i += 1) {
    if (await fetch(`${base}/`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  assert.ok(await fetch(`${base}/`).then((r) => r.ok, () => false), `web server did not start:\n${server.output}`);
  assert.doesNotMatch(server.output, /\[jobs\] worker started/, "in external mode the web server does not work the queue itself");

  const form = new FormData();
  form.set("file", new File([await spreadPdf(40, Date.now() % 997)], "recovery.pdf", { type: "application/pdf" }));
  form.set("title", `Recovery ${Date.now()}`);
  const uploaded = (await call("/api/core/files?allowDuplicate=true", { method: "POST", body: form })).body;
  const versionId = uploaded.version.id;
  const queued = await call("/api/page-split", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId }) });
  assert.equal(queued.status, 202);
  const jobState = async () => (await call(`/api/v1/jobs?subjectId=${versionId}`)).body.jobs[0];

  // 1. Nobody is working the queue, so the job waits.
  await sleep(4000);
  assert.equal((await jobState()).state, "queued", "with no worker running, the job waits in the queue");

  // 2. A worker starts and takes it.
  const first = startWorker();
  let job;
  for (let i = 0; i < 120; i += 1) {
    job = await jobState();
    if (job.state === "running" && job.progress && job.progress.done >= 6) break;
    await sleep(250);
  }
  assert.equal(job.state, "running", `the worker did not start the job:\n${first.output}`);
  assert.ok(job.progress.done >= 6 && job.progress.done < 40, `killed mid-job (at page ${job.progress.done})`);

  // 3. Kill it without warning.
  killGroup(first, "SIGKILL");
  await first.exited;
  const afterKill = await jobState();
  assert.equal(afterKill.state, "running", "the dead worker leaves the job looking 'running' until it is noticed");
  const killedAt = afterKill.progress?.done ?? 0;

  // 4. A new worker notices (heartbeat 10 s, check every 3 s), retries, and finishes.
  const second = startWorker();
  const deadline = Date.now() + 120_000;
  for (;;) {
    job = await jobState();
    if (job.state === "complete" || job.state === "failed") break;
    assert.ok(Date.now() < deadline, `the job was never recovered; last state ${JSON.stringify(job)}\n${second.output}`);
    await sleep(500);
  }
  assert.equal(job.state, "complete", `${job.error}\n${second.output}`);
  assert.equal(job.attempts, 2, "it ran twice: once before the crash, once after");
  assert.deepEqual(job.progress, { done: 40, total: 40 }, "the retry did the whole job again");
  assert.ok(killedAt < 40);
  const split = (await call(`/api/page-split?documentId=${uploaded.document.id}`)).body.results[0];
  assert.equal(split.splitReady, true, "the web server serves the result the second worker produced");

  // 5. A worker told to stop (SIGTERM) shuts down cleanly.
  process.kill(second.pid, "SIGTERM"); // tsx forwards it to the worker
  const code = await Promise.race([second.exited, sleep(30_000).then(() => "timeout")]);
  assert.equal(code, 0, `the worker did not stop cleanly:\n${second.output}`);

  console.log("Worker recovery verified: queued without a worker, live progress, killed mid-job, retried by a new worker, clean shutdown.");
} finally {
  cleanup();
}
