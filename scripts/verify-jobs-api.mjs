// Live check of the job queue (inline worker): jobs are queued and recorded, progress is visible,
// asking twice does not run twice, heavy jobs never overlap, and a failing job is retried once,
// recorded as failed, and can be run again.
import assert from "node:assert/strict";
import { spreadPdf } from "./lib-test-pdf.mjs";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const call = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
};
const post = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = Date.now();

async function upload(title, bytes) {
  const form = new FormData();
  form.set("file", new File([bytes], `${title}.pdf`, { type: "application/pdf" }));
  form.set("title", `${title} ${stamp}`);
  const result = await call("/api/core/files?allowDuplicate=true", { method: "POST", body: form });
  assert.equal(result.status, 201);
  return { documentId: result.body.document.id, versionId: result.body.version.id };
}
const jobsFor = async (subjectId) => (await call(`/api/v1/jobs?subjectId=${subjectId}`)).body.jobs;
async function waitFor(subjectId, states, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [job] = await jobsFor(subjectId);
    if (job && states.includes(job.state)) return job;
    assert.ok(Date.now() < until, `timed out waiting for ${states.join("/")}; last: ${JSON.stringify(job)}`);
    await sleep(300);
  }
}

// --- a job is recorded, shows live progress, and finishes with a result
const spread = await upload("Jobs spread", await spreadPdf(10, stamp % 997));
const first = await post("/api/page-split", { versionId: spread.versionId });
assert.equal(first.status, 202);
assert.equal(typeof first.body.jobId, "string");
const second = await post("/api/page-split", { versionId: spread.versionId });
assert.equal(second.status, 202);
assert.equal(second.body.alreadyRunning, true, "asking again while it is queued or running does not start a second job");
assert.equal(second.body.jobId, first.body.jobId, "and returns the same job");
const seenProgress = new Set();
let job;
for (;;) {
  [job] = await jobsFor(spread.versionId);
  if (job.progress) seenProgress.add(job.progress.done);
  if (job.state === "complete" || job.state === "failed") break;
  await sleep(150);
}
assert.equal(job.state, "complete", job.error ?? "");
assert.equal(job.type, "page-split");
assert.equal(job.attempts, 1);
assert.ok(seenProgress.size >= 2, `progress moved while the job ran (saw ${[...seenProgress]})`);
assert.deepEqual(job.progress, { done: 10, total: 10 });
const split = (await call(`/api/page-split?documentId=${spread.documentId}`)).body.results[0];
assert.equal(split.splitReady, true, "the split screen reads the finished job");
assert.ok(split.splitSummary.newPageCount >= split.splitSummary.originalPageCount);
assert.equal((await call(`/api/v1/jobs/${job.id}`)).body.id, job.id);
assert.equal((await call("/api/v1/jobs/nope")).status, 404);
assert.ok((await call("/api/v1/jobs?state=complete&type=page-split&limit=100")).body.jobs.some((entry) => entry.id === job.id), "listing filters by type and state");
assert.equal((await call("/api/v1/jobs?state=bogus")).status, 400);

// --- heavy jobs never overlap
const a = await upload("Jobs overlap A", await spreadPdf(10, (stamp + 1) % 997));
const b = await upload("Jobs overlap B", await spreadPdf(10, (stamp + 2) % 997));
await post("/api/page-split", { versionId: a.versionId });
await post("/api/page-split", { versionId: b.versionId });
let overlap = false;
for (;;) {
  const [ja] = await jobsFor(a.versionId);
  const [jb] = await jobsFor(b.versionId);
  if (ja.state === "running" && jb.state === "running") overlap = true;
  if (["complete", "failed"].includes(ja.state) && ["complete", "failed"].includes(jb.state)) {
    assert.equal(ja.state, "complete");
    assert.equal(jb.state, "complete");
    break;
  }
  await sleep(100);
}
assert.equal(overlap, false, "two heavy jobs were never running at once");

// --- a failing job is retried once, recorded as failed, and can be run again
const broken = await upload("Jobs broken", Buffer.from("%PDF-1.4\nthis is not really a pdf\n%%EOF\n"));
const ocr = await post("/api/ocr/status", { versionId: broken.versionId });
assert.equal(ocr.status, 202);
const failed = await waitFor(broken.versionId, ["failed"], 60_000);
assert.equal(failed.attempts, 2, "one automatic retry");
assert.ok(failed.error, "the reason is kept");
const state = (await call(`/api/ocr/status?documentId=${broken.documentId}`)).body.results[0];
assert.equal(state.ocrRunning, false, "the book is not left 'running'");
assert.match(state.extractionState, /failed/);
assert.equal((await post(`/api/v1/jobs/${job.id}/retry`, {})).status, 409, "only a failed job can be retried");
const retried = await post(`/api/v1/jobs/${failed.id}/retry`, {});
assert.equal(retried.status, 202);
assert.notEqual(retried.body.id, failed.id, "a retry is a new job; the failed one stays as history");
assert.equal((await call(`/api/v1/jobs?state=failed&subjectId=${broken.versionId}`)).body.jobs.some((entry) => entry.id === failed.id), true);

// --- the meaning index goes through the same queue
const indexed = await post("/api/embeddings", { documentId: a.documentId });
assert.equal(indexed.status, 202);
const indexJob = await waitFor(a.documentId, ["complete", "failed"], 60_000);
assert.equal(indexJob.type, "embed-index");
assert.equal(indexJob.state, "complete", indexJob.error ?? "");

console.log("Job queue verified: recorded and visible, live progress, no duplicates, one heavy job at a time, retry then failed, rerun.");
