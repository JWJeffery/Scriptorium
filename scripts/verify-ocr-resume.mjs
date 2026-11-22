// Proves long jobs finish and never get stuck. Starts a web server in "external" mode (it only queues
// jobs) and standalone worker processes, then checks, against real OCR of a small scanned book:
//   a. OCR produces exactly the TextSpans an uninterrupted, unbatched run produces (page text, word
//      positions, confidence, warnings on the first page);
//   b. a worker told to stop (SIGTERM) mid-book saves the pages it has done and exits quickly; the next
//      worker continues from the first unsaved page, not page 1. The same after the OCR time limit
//      stops a run: Retry continues from the saved pages;
//   c. a job record left RUNNING/QUEUED with no live queue job is marked FAILED, can be retried, and
//      does not block asking for the same work again;
//   d. one database-wide lock: a backup is refused (429) while a job runs, and a job waits while
//      someone else holds the lock.
// Needs a built app (pnpm build) and a migrated database. Uses its own port; nothing else may be working
// the same database's job queue while it runs.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scannedTextPdf, spreadPdf, textPdf } from "./lib-test-pdf.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "apps/web");
const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
const requireFromWeb = createRequire(path.join(webDir, "package.json"));
const { PrismaClient } = requireFromWeb("@prisma/client");
const pg = requireFromWeb("pg");
const prisma = new PrismaClient();

const port = Number(process.env.SCRIPTORIUM_OCR_RESUME_PORT ?? 3241);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HEAVY_LOCK_KEY = 7274837201; // lib/heavy-job-lock.ts
const BUSY = "Another long job (OCR, page split or backup) is running. Try again when it has finished.";
const env = {
  ...process.env,
  SCRIPTORIUM_WORKER_MODE: "external",
  SCRIPTORIUM_AUTH_DISABLED: "true",
  SCRIPTORIUM_RATE_LIMITS_DISABLED: "true",
  SCRIPTORIUM_FAKE_EMBEDDINGS: "1",
  SCRIPTORIUM_JOB_HEARTBEAT_SECONDS: "10",
  SCRIPTORIUM_JOB_SUPERVISE_SECONDS: "3",
  SCRIPTORIUM_JOB_RECONCILE_SECONDS: "3",
  SCRIPTORIUM_OCR_BATCH_PAGES: "3"
};

const children = [];
function start(name, command, args, extra = {}) {
  // Own process group, so a kill reaches the real worker that tsx starts as a child, not just tsx.
  const child = spawn(command, args, { cwd: webDir, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk; });
  child.stderr.on("data", (chunk) => { child.output += chunk; });
  child.exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  child.label = name;
  children.push(child);
  return child;
}
const startWorker = (extra) => start("worker", "node", ["--import", "tsx", "worker/main.ts"], extra);
const killGroup = (child, signal) => { try { process.kill(-child.pid, signal); } catch { /* already gone */ } };
const cleanup = () => { for (const child of children) killGroup(child, "SIGKILL"); };
process.on("exit", cleanup);

async function stopWorker(worker) {
  const began = Date.now();
  process.kill(worker.pid, "SIGTERM"); // the worker itself (tsx is loaded inside node, not a wrapper)
  const code = await Promise.race([worker.exited, sleep(50_000).then(() => "timeout")]);
  const seconds = (Date.now() - began) / 1000;
  assert.equal(code, 0, `the worker did not stop cleanly (${code}):\n${worker.output.slice(-3000)}`);
  assert.ok(seconds < 45, `the worker took ${seconds}s to stop`);
  return seconds;
}

const call = async (route, init) => {
  const response = await fetch(`${base}${route}`, init);
  return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
};
const post = (route, body) => call(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const latestJob = async (subjectId) => (await call(`/api/v1/jobs?subjectId=${subjectId}`)).body.jobs[0];
async function waitForJob(subjectId, test, what, timeoutMs = 180_000, worker) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const job = await latestJob(subjectId);
    if (job && test(job)) return job;
    assert.ok(Date.now() < until, `timed out waiting for ${what}; last: ${JSON.stringify(job)}\n${worker?.output.slice(-3000) ?? ""}`);
    await sleep(250);
  }
}
const finished = (job) => job.state === "complete" || job.state === "failed";

const scratch = mkdtempSync(path.join(tmpdir(), "scriptorium-ocr-resume-"));
async function uploadScan(title, bytes) {
  const form = new FormData();
  form.set("file", new File([bytes], `${title}.pdf`, { type: "application/pdf" }));
  form.set("title", `${title} ${Date.now()}`);
  const result = await call("/api/core/files?allowDuplicate=true", { method: "POST", body: form });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { documentId: result.body.document.id, versionId: result.body.version.id };
}
// What an uninterrupted, unbatched OCR run writes for these bytes (scripts/lib-ocr-reference.mts).
async function referenceSpans(bytes, name) {
  const pdfPath = path.join(scratch, `${name}.pdf`);
  const outPath = path.join(scratch, `${name}.json`);
  writeFileSync(pdfPath, bytes);
  // Not execFileSync: blocking this process would let the web server drop its idle keep-alive sockets.
  await promisify(execFile)(process.execPath, ["node_modules/tsx/dist/cli.mjs", path.join(repoRoot, "scripts/lib-ocr-reference.mts"), pdfPath, outPath], { cwd: webDir, maxBuffer: 64 * 1024 * 1024 });
  const spans = JSON.parse(readFileSync(outPath, "utf8"));
  // Stored once the way the OCR job always stored them (one createMany), because a stored JSON number can
  // differ from the JS value in its last digit (Prisma's JSON encoding), and read back.
  const holder = holderVersionId;
  await prisma.textSpan.deleteMany({ where: { versionId: holder } });
  await prisma.textSpan.createMany({ data: spans.map((span) => ({ versionId: holder, ...span })) });
  const stored = await prisma.textSpan.findMany({ where: { versionId: holder }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { text: true, anchor: true } });
  await prisma.textSpan.deleteMany({ where: { versionId: holder } });
  return stored;
}
let holderVersionId;
const savedPages = async (versionId) =>
  (await prisma.$queryRaw`SELECT (anchor->>'pdfPageIndex')::int AS page FROM "TextSpan" WHERE "versionId" = ${versionId} AND anchor->>'ocrPending' = 'true' ORDER BY 1`).map((row) => Number(row.page));
async function assertFinalSpans(versionId, expected, label) {
  const spans = await prisma.textSpan.findMany({ where: { versionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { text: true, anchor: true } });
  assert.equal(spans.length, expected.length, `${label}: one span per page`);
  spans.forEach((span, i) => assert.deepEqual(span, expected[i], `${label}: page ${i + 1} differs from an uninterrupted run`));
  const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
  assert.equal(version.extractionState, "tesseract-js-eng-v1", `${label}: OCR marked done`);
}
// The page numbers a worker's log shows it recognizing for a book of `total` pages.
const pagesRead = (output, total) => [...output.matchAll(new RegExp(`\\[OCR-SERVER-DEBUG\\] page (\\d+)/${total}:`, "g"))].map((m) => Number(m[1]));

try {
  assert.equal(await fetch(`${base}/`).then(() => true, () => false), false, `port ${port} is already in use; set SCRIPTORIUM_OCR_RESUME_PORT`);
  const server = start("web", "node", ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)]);
  for (let i = 0; i < 60; i += 1) {
    if (await fetch(`${base}/`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  assert.ok(await fetch(`${base}/`).then((r) => r.ok, () => false), `web server did not start:\n${server.output}`);

  // ---- (a) + (b): stopped by SIGTERM mid-book, continued by the next worker, same result as one pass.
  holderVersionId = (await uploadScan("OCR reference holder", await textPdf([["reference"]]))).versionId;
  const TOTAL = 24;
  const bookBytes = await scannedTextPdf(TOTAL, 3);
  const book = await uploadScan("OCR resume", bookBytes);
  const expected = await referenceSpans(bookBytes, "book");
  assert.equal(expected.length, TOTAL);
  assert.ok(expected[0].anchor.ocrWarnings?.length > 0, "the test book has a smudged page, so there are warnings to carry");
  assert.equal((await post("/api/ocr/status", { versionId: book.versionId })).status, 202);

  const first = startWorker();
  const running = await waitForJob(book.versionId, (job) => job.state === "running" && job.progress?.done >= 5, "OCR to get going", 120_000, first);
  assert.ok(running.progress.done < TOTAL, `stopped mid-book (at page ${running.progress.done})`);
  const stopSeconds = await stopWorker(first);
  const paused = await latestJob(book.versionId);
  assert.equal(paused.state, "queued", `after a shutdown the job waits to continue: ${JSON.stringify(paused)}`);
  assert.equal(paused.error, null);
  const saved = await savedPages(book.versionId);
  assert.ok(saved.length >= 5 && saved.length < TOTAL, `the pages done before the shutdown are saved (${saved})`);
  assert.deepEqual(saved, Array.from({ length: saved.length }, (_, i) => i + 1), "saved pages are the first ones, in order");
  const ocrStatus = (await call(`/api/ocr/status?documentId=${book.documentId}`)).body.results[0];
  assert.equal(ocrStatus.ocrRunning, true, "the book still shows OCR as running: it continues after the restart");
  assert.equal(ocrStatus.pageCount, TOTAL, "still one span per page while partly done");
  const pageText = (await call(`/api/ocr/page-text?versionId=${book.versionId}&pdfPageIndex=1`)).body;
  assert.equal(pageText.source, "ocr", "pages already read are usable at once");

  const second = startWorker();
  const done = await waitForJob(book.versionId, finished, "the resumed OCR to finish", 180_000, second);
  assert.equal(done.state, "complete", `${done.error}\n${second.output.slice(-3000)}`);
  assert.equal(done.id, paused.id, "the same job continued");
  const secondPages = pagesRead(second.output, TOTAL);
  assert.equal(secondPages[0], saved.length + 1, `the next worker started at the first unsaved page, not page 1 (read ${secondPages})`);
  assert.ok(!secondPages.some((page) => page <= saved.length), "no saved page was read again");
  assert.match(second.output, /were saved by an earlier run/);
  await assertFinalSpans(book.versionId, expected, "resumed after shutdown");
  assert.deepEqual(await savedPages(book.versionId), [], "no partial-progress markers remain");
  console.log(`  ok: SIGTERM at page ${running.progress.done} (worker exited in ${stopSeconds.toFixed(1)} s); resumed at page ${saved.length + 1}; final spans identical`);

  // ---- (b) again, after the OCR time limit: the job fails clearly, Retry continues from the saved pages.
  await stopWorker(second);
  const SHORT = 12;
  const shortBytes = await scannedTextPdf(SHORT, 5);
  const short = await uploadScan("OCR time limit", shortBytes);
  const expectedShort = await referenceSpans(shortBytes, "short");
  assert.equal((await post("/api/ocr/status", { versionId: short.versionId })).status, 202);
  const hurried = startWorker({ SCRIPTORIUM_OCR_BASE_SECONDS: "2", SCRIPTORIUM_OCR_SECONDS_PER_PAGE: "0.25" });
  const timedOut = await waitForJob(short.versionId, finished, "the OCR time limit", 120_000, hurried);
  assert.equal(timedOut.state, "failed", "the time limit stopped it");
  assert.match(timedOut.error, /OCR timed out/);
  assert.equal(timedOut.attempts, 1, "a time-out is not retried automatically");
  const shortState = (await call(`/api/ocr/status?documentId=${short.documentId}`)).body.results[0];
  assert.equal(shortState.ocrRunning, false);
  assert.equal(shortState.extractionState, "tesseract-js-eng-v1-timed-out");
  const savedShort = await savedPages(short.versionId);
  assert.ok(savedShort.length < SHORT, "it really stopped before the end");
  const readBeforeLimit = pagesRead(hurried.output, SHORT);
  assert.ok(readBeforeLimit.length <= savedShort.length + 1, `the page loop really stopped (read ${readBeforeLimit}, saved ${savedShort})`);
  await sleep(1500);
  assert.equal(pagesRead(hurried.output, SHORT).length, readBeforeLimit.length, "no page is read after the time limit");
  await stopWorker(hurried);

  const third = startWorker();
  const retried = await post(`/api/v1/jobs/${timedOut.id}/retry`, {});
  assert.equal(retried.status, 202);
  const retryDone = await waitForJob(short.versionId, (job) => job.id === retried.body.id && finished(job), "the retried OCR", 120_000, third);
  assert.equal(retryDone.state, "complete", retryDone.error ?? "");
  const thirdPages = pagesRead(third.output, SHORT);
  assert.equal(thirdPages[0], savedShort.length + 1, `Retry continued from the saved pages (${savedShort.length} saved, read ${thirdPages})`);
  await assertFinalSpans(short.versionId, expectedShort, "resumed after a time-out");
  console.log(`  ok: time limit stopped OCR after ${savedShort.length} saved page(s); Retry continued from page ${savedShort.length + 1}; final spans identical`);

  // ---- (c) records with no live queue job are reconciled to FAILED and can be retried.
  const spread = await uploadScan("Stale job", await spreadPdf(4, Date.now() % 991));
  const staleRunning = await prisma.processingJob.create({
    data: { type: "page-split", subjectId: spread.versionId, state: "RUNNING", attempts: 1, startedAt: new Date(), queueJobId: randomUUID() }
  });
  await prisma.documentVersion.update({ where: { id: short.versionId }, data: { extractionState: "tesseract-js-eng-v1-running" } });
  const staleQueued = await prisma.processingJob.create({
    data: { type: "ocr", subjectId: short.versionId, state: "QUEUED", createdAt: new Date(Date.now() - 3600_000) }
  });
  for (let i = 0; ; i += 1) {
    const rows = await prisma.processingJob.findMany({ where: { id: { in: [staleRunning.id, staleQueued.id] } } });
    if (rows.every((row) => row.state === "FAILED")) {
      for (const row of rows) assert.match(row.error, /stopped without finishing/);
      break;
    }
    assert.ok(i < 60, `stale records were not reconciled: ${JSON.stringify(rows)}\n${third.output.slice(-2000)}`);
    await sleep(250);
  }
  const shortAfter = await prisma.documentVersion.findUnique({ where: { id: short.versionId } });
  assert.equal(shortAfter.extractionState, "tesseract-js-eng-v1-failed", "the book no longer shows OCR running");
  const staleRetry = await post(`/api/v1/jobs/${staleRunning.id}/retry`, {});
  assert.equal(staleRetry.status, 202, "a reconciled job can be retried");
  const staleRetryDone = await waitForJob(spread.versionId, (job) => job.id === staleRetry.body.id && finished(job), "the retried page split", 120_000, third);
  assert.equal(staleRetryDone.state, "complete", staleRetryDone.error ?? "");
  // Asking for the work again is not answered with a dead record (even before reconciliation runs).
  const staleAgain = await prisma.processingJob.create({
    data: { type: "page-split", subjectId: spread.versionId, state: "RUNNING", attempts: 1, startedAt: new Date(), queueJobId: randomUUID() }
  });
  const asked = await post("/api/page-split", { versionId: spread.versionId });
  assert.equal(asked.status, 202);
  assert.notEqual(asked.body.jobId, staleAgain.id, "a stuck record is not returned as 'already running'");
  assert.equal((await prisma.processingJob.findUnique({ where: { id: staleAgain.id } })).state, "FAILED");
  const askedDone = await waitForJob(spread.versionId, (job) => job.id === asked.body.jobId && finished(job), "the new page split", 120_000, third);
  assert.equal(askedDone.state, "complete", askedDone.error ?? "");
  console.log("  ok: stuck RUNNING/QUEUED records marked failed, retried, and no longer block new work");

  // ---- (d) one heavy task server-wide.
  const holder = new pg.Client({ connectionString: process.env.DATABASE_URL.replace(/([?&])schema=[^&]*&?/, "$1").replace(/[?&]$/, "") });
  await holder.connect();
  assert.equal((await holder.query("SELECT pg_try_advisory_lock($1) AS locked", [HEAVY_LOCK_KEY])).rows[0].locked, true);
  const refused = await call("/api/backup", { method: "POST" });
  assert.equal(refused.status, 429, "a backup is refused while another heavy task holds the lock");
  assert.equal(refused.body.error, BUSY);
  assert.equal((await call("/api/backup/download")).status, 429);
  const waiting = await uploadScan("Lock wait", await spreadPdf(4, (Date.now() + 1) % 991));
  assert.equal((await post("/api/page-split", { versionId: waiting.versionId })).status, 202);
  await waitForJob(waiting.versionId, (job) => job.state === "running", "the job to be taken", 30_000, third);
  await sleep(6000);
  const held = await latestJob(waiting.versionId);
  assert.equal(held.state, "running");
  assert.equal(held.progress, null, "the job waits for the lock instead of running beside the other heavy task");
  await holder.query("SELECT pg_advisory_unlock($1)", [HEAVY_LOCK_KEY]);
  await holder.end();
  const afterLock = await waitForJob(waiting.versionId, finished, "the job after the lock was freed", 60_000, third);
  assert.equal(afterLock.state, "complete", afterLock.error ?? "");

  // While the worker runs an OCR, a backup in the web server is refused.
  assert.equal((await post("/api/ocr/status", { versionId: book.versionId })).status, 202);
  await waitForJob(book.versionId, (job) => job.state === "running" && job.progress?.done >= 2, "a running OCR", 60_000, third);
  const duringOcr = await call("/api/backup", { method: "POST" });
  assert.equal(duringOcr.status, 429, "the web server's backup sees the worker's lock");
  assert.equal(duringOcr.body.error, BUSY);
  await waitForJob(book.versionId, finished, "that OCR", 180_000, third);
  const backup = await call("/api/backup", { method: "POST" });
  assert.equal(backup.status, 201, `a backup runs once the lock is free: ${JSON.stringify(backup.body)}`);
  await call(`/api/backup?name=${encodeURIComponent(backup.body.name)}`, { method: "DELETE" });
  console.log("  ok: backups and jobs share one database-wide lock");

  await stopWorker(third);
  console.log("OCR resume verified: identical spans, batch saves, resume after shutdown and after a time-out, stuck jobs reconciled, one heavy task at a time.");
} catch (error) {
  const web = children.find((child) => child.label === "web");
  if (web) console.error(`--- web server output (last part) ---\n${web.output.slice(-4000)}`);
  throw error;
} finally {
  cleanup();
  await prisma.$disconnect();
  rmSync(scratch, { recursive: true, force: true });
}
