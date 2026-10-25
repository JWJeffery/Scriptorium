// Smoke test of the PRODUCTION stack (docker-compose.prod.yml), through its public front door.
// It proves: HTTPS/front-door wiring serves the app, sign-in is enforced, the database was set up,
// uploads work, a job queued by the web container is run by the SEPARATE worker container, the
// result is readable by the web container (shared storage), and a backup downloads.
//   SCRIPTORIUM_BASE_URL=http://127.0.0.1 SCRIPTORIUM_AUTH_USER=... SCRIPTORIUM_AUTH_PASSWORD=... node scripts/verify-production-stack.mjs
import assert from "node:assert/strict";
import { spreadPdf } from "./lib-test-pdf.mjs";

const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1";
const user = process.env.SCRIPTORIUM_AUTH_USER;
const password = process.env.SCRIPTORIUM_AUTH_PASSWORD;
assert.ok(user && password, "SCRIPTORIUM_AUTH_USER and SCRIPTORIUM_AUTH_PASSWORD are required");
const auth = { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const call = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  return { status: response.status, response, body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
};

// The front door serves the login page with the security headers, and gates everything else.
const login = await fetch(`${base}/login`);
assert.equal(login.status, 200, "the login page is served");
assert.ok(login.headers.get("content-security-policy"), "security headers reach the browser through the proxy");
const anonymous = await fetch(`${base}/`, { redirect: "manual", headers: { accept: "text/html" } });
assert.equal(anonymous.status, 307, "an anonymous visitor is sent to sign in");
assert.match(anonymous.headers.get("location") ?? "", /\/login/);
assert.equal((await fetch(`${base}/api/v1/items`)).status, 401, "the API refuses anonymous callers");

// The database exists and has its tables (the migrate step ran).
const items = await call("/api/v1/items?limit=1");
assert.equal(items.status, 200, `the library API works (database set up): ${JSON.stringify(items.body)}`);

// Upload, then a job that only the worker container can run.
const form = new FormData();
form.set("file", new File([await spreadPdf(4, Date.now() % 997)], "stack.pdf", { type: "application/pdf" }));
form.set("title", `Stack check ${Date.now()}`);
const uploaded = await call("/api/core/files?allowDuplicate=true", { method: "POST", body: form });
assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
const versionId = uploaded.body.version.id;
const queued = await call("/api/page-split", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId }) });
assert.equal(queued.status, 202, JSON.stringify(queued.body));

let job;
for (let i = 0; i < 240; i += 1) {
  job = (await call(`/api/v1/jobs?subjectId=${versionId}`)).body.jobs[0];
  if (job && (job.state === "complete" || job.state === "failed")) break;
  await sleep(500);
}
assert.equal(job?.state, "complete", `the worker container finished the job: ${JSON.stringify(job)}`);
assert.equal(job.attempts, 1);

// The result was written by the worker; the web container can read it.
const result = await fetch(`${base}/api/page-split/download?versionId=${versionId}`, { headers: auth });
assert.equal(result.status, 200, "the split result downloads");
assert.equal(Buffer.from(await result.arrayBuffer()).subarray(0, 4).toString(), "%PDF", "and it is a PDF");

// A backup streams as a ZIP.
const backup = await fetch(`${base}/api/backup/download`, { headers: auth });
assert.equal(backup.status, 200);
assert.equal(Buffer.from(await backup.arrayBuffer()).subarray(0, 2).toString(), "PK", "the backup is a ZIP");

console.log("Production stack verified: front door, sign-in gate, database setup, upload, job run by the separate worker, shared files, backup.");
