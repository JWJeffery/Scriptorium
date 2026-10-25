// Live check of S3-compatible object storage. Run against a server started with
//   SCRIPTORIUM_STORAGE_BACKEND=s3  SCRIPTORIUM_S3_BUCKET=...  SCRIPTORIUM_S3_ENDPOINT=...  (+ keys)
// and SCRIPTORIUM_STORAGE_DIR pointing at an (initially empty) local folder, with the same variables
// set for this script. It proves: new files go to the bucket and not to disk, a file that is only in
// the old local folder is still readable, and the copy script is safe (dry run, verify, idempotent,
// never overwrites a different object unless told to).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { textPdf } from "./lib-test-pdf.mjs";

if (process.env.SCRIPTORIUM_STORAGE_BACKEND !== "s3") {
  console.log("Object storage check skipped (SCRIPTORIUM_STORAGE_BACKEND is not s3).");
  process.exit(0);
}
const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } = requireFromWeb("@aws-sdk/client-s3");
const bucket = process.env.SCRIPTORIUM_S3_BUCKET;
const endpoint = process.env.SCRIPTORIUM_S3_ENDPOINT || undefined;
const storageDir = path.resolve(process.env.SCRIPTORIUM_STORAGE_DIR ?? "./storage");
const s3 = new S3Client({
  region: process.env.SCRIPTORIUM_S3_REGION || "us-east-1", ...(endpoint ? { endpoint } : {}), forcePathStyle: Boolean(endpoint),
  ...(process.env.SCRIPTORIUM_S3_ACCESS_KEY_ID ? { credentials: { accessKeyId: process.env.SCRIPTORIUM_S3_ACCESS_KEY_ID, secretAccessKey: process.env.SCRIPTORIUM_S3_SECRET_ACCESS_KEY ?? "" } } : {}),
  requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED"
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = (file) => access(file).then(() => true, () => false);
const objectBytes = async (key) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToByteArray());
const apiBytes = async (id) => Buffer.from(await (await fetch(`${baseUrl}/api/core/files/${id}`)).arrayBuffer());
const copy = (...args) => spawnSync("node", ["scripts/migrate-files-to-s3.mjs", ...args], { encoding: "utf8", cwd: path.resolve(new URL("..", import.meta.url).pathname), env: { ...process.env, SCRIPTORIUM_STORAGE_DIR: storageDir } });

// 1. A new upload lands in the bucket, not on local disk, and reads back byte for byte.
const pdf = Buffer.from(await textPdf([[`Object storage ${Date.now()}`], ["second page"]]));
const form = new FormData();
form.set("file", new File([pdf], "object-storage.pdf", { type: "application/pdf" }));
form.set("title", "Object storage fixture");
const uploaded = await (await fetch(`${baseUrl}/api/core/files?allowDuplicate=true`, { method: "POST", body: form })).json();
const id = uploaded.document.id;
const key = uploaded.storedFile.storageKey;
assert.equal((await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ContentLength, pdf.length, "the file is in the bucket");
assert.equal(await exists(path.join(storageDir, key)), false, "and was not written to local disk");
assert.equal(sha(await apiBytes(id)), sha(pdf), "the reader gets the same bytes back");
const item = await (await fetch(`${baseUrl}/api/v1/items/${id}`)).json();
assert.equal(item.preservation.originalStored, true);
assert.equal(item.preservation.sizeBytes, pdf.length);

// 2. Copy-first transition: a file that only exists in the old local folder is still readable.
await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
await mkdir(path.dirname(path.join(storageDir, key)), { recursive: true });
await writeFile(path.join(storageDir, key), pdf);
assert.equal(sha(await apiBytes(id)), sha(pdf), "a file not yet copied is served from the old folder");
assert.equal((await (await fetch(`${baseUrl}/api/v1/items/${id}`)).json()).preservation.originalStored, true);

// 3. The copy script: dry run changes nothing; the real run copies and verifies; a second run is a no-op.
const dry = copy("--dry-run");
assert.equal(dry.status, 0, dry.stderr + dry.stdout);
assert.match(dry.stdout, /Would copy:\s+1/);
await assert.rejects(s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })), "a dry run writes nothing");
const real = copy();
assert.equal(real.status, 0, real.stderr + real.stdout);
assert.match(real.stdout, /Copied and verified:\s+1/);
assert.equal(sha(await objectBytes(key)), sha(pdf), "the copied object is identical");
assert.equal(await exists(path.join(storageDir, key)), true, "the local file is left untouched");
const again = copy();
assert.equal(again.status, 0);
assert.match(again.stdout, /Copied and verified:\s+0/);
assert.match(again.stdout, /Already in bucket, same:\s+1/);

// 4. An object that differs from the local file is reported and never silently replaced.
await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from("something else") }));
const clash = copy();
assert.equal(clash.status, 1, "a difference makes the run fail");
assert.match(clash.stdout, /In bucket but DIFFERENT:\s+1/);
assert.equal((await objectBytes(key)).toString(), "something else", "and the bucket object is left alone");
const forced = copy("--overwrite");
assert.equal(forced.status, 0, forced.stderr + forced.stdout);
assert.equal(sha(await objectBytes(key)), sha(pdf), "--overwrite repairs it from the local copy");

console.log("Object storage verified: bucket writes, byte-for-byte reads, old-folder fallback, and a safe, verified, idempotent copy.");
