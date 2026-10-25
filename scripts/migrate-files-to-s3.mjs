// Copies the files in your local storage folder (originals, text snapshots, job results) into
// S3-compatible object storage. Copy-first: nothing is ever deleted or modified in the local folder,
// and a file already in the bucket is never overwritten unless you pass --overwrite.
//
//   node scripts/migrate-files-to-s3.mjs [--dry-run] [--overwrite]
//
// Settings come from the environment or the repository's .env:
//   SCRIPTORIUM_STORAGE_DIR                 the local folder to copy FROM
//   SCRIPTORIUM_S3_BUCKET, SCRIPTORIUM_S3_ENDPOINT, SCRIPTORIUM_S3_REGION,
//   SCRIPTORIUM_S3_ACCESS_KEY_ID, SCRIPTORIUM_S3_SECRET_ACCESS_KEY, SCRIPTORIUM_S3_FORCE_PATH_STYLE,
//   SCRIPTORIUM_S3_CREATE_BUCKET=true       (development: create the bucket if it does not exist)
//
// After every upload the object is read back and its SHA-256 compared with the local file. The run
// ends with a report; keep using the local folder (SCRIPTORIUM_STORAGE_BACKEND unset) until it is clean,
// then set SCRIPTORIUM_STORAGE_BACKEND=s3.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
} catch {
  // No .env file: rely on the environment.
}

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, HeadBucketCommand, CreateBucketCommand } = requireFromWeb("@aws-sdk/client-s3");

const dryRun = process.argv.includes("--dry-run");
const overwrite = process.argv.includes("--overwrite");
const bucket = process.env.SCRIPTORIUM_S3_BUCKET?.trim();
if (!bucket) {
  console.error("Set SCRIPTORIUM_S3_BUCKET (and the other SCRIPTORIUM_S3_* settings) first.");
  process.exit(2);
}
const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const configured = process.env.SCRIPTORIUM_STORAGE_DIR?.trim() || "./storage";
const sourceRoot = path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);

const endpoint = process.env.SCRIPTORIUM_S3_ENDPOINT?.trim() || undefined;
const client = new S3Client({
  region: process.env.SCRIPTORIUM_S3_REGION?.trim() || "us-east-1",
  ...(endpoint ? { endpoint } : {}),
  forcePathStyle: process.env.SCRIPTORIUM_S3_FORCE_PATH_STYLE ? process.env.SCRIPTORIUM_S3_FORCE_PATH_STYLE === "true" : Boolean(endpoint),
  ...(process.env.SCRIPTORIUM_S3_ACCESS_KEY_ID ? { credentials: { accessKeyId: process.env.SCRIPTORIUM_S3_ACCESS_KEY_ID, secretAccessKey: process.env.SCRIPTORIUM_S3_SECRET_ACCESS_KEY ?? "" } } : {}),
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED"
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const missing = (error) => error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;

async function walk(dir, relative = "") {
  const entries = await readdir(path.join(dir, relative), { withFileTypes: true }).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
  const files = [];
  for (const entry of entries) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await walk(dir, next)));
    else files.push(next);
  }
  return files;
}

if (process.env.SCRIPTORIUM_S3_CREATE_BUCKET === "true" && !dryRun) {
  try { await client.send(new HeadBucketCommand({ Bucket: bucket })); } catch { await client.send(new CreateBucketCommand({ Bucket: bucket })); }
}

const report = { startedAt: new Date().toISOString(), sourceRoot, bucket, dryRun, overwrite, copied: [], alreadyThere: [], differentInBucket: [], verifyFailed: [], bytesCopied: 0 };
const files = (await walk(sourceRoot)).sort();

for (const key of files) {
  const bytes = await readFile(path.join(sourceRoot, key));
  const localHash = sha256(bytes);
  let existing = null;
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    existing = { size: head.ContentLength, hash: sha256(Buffer.from(await response.Body.transformToByteArray())) };
  } catch (error) {
    if (!missing(error)) throw error;
  }
  if (existing && existing.hash === localHash) { report.alreadyThere.push(key); continue; }
  if (existing && !overwrite) { report.differentInBucket.push({ key, localSha256: localHash, bucketSha256: existing.hash }); continue; }
  if (dryRun) { report.copied.push(key); report.bytesCopied += bytes.length; continue; }
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }));
  const back = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const backHash = sha256(Buffer.from(await back.Body.transformToByteArray()));
  if (backHash !== localHash) { report.verifyFailed.push(key); continue; }
  report.copied.push(key);
  report.bytesCopied += bytes.length;
}

report.finishedAt = new Date().toISOString();
const file = `files-report-${report.startedAt.replace(/[:.]/g, "-")}.json`;
await writeFile(file, JSON.stringify(report, null, 2));
console.log(`Local files found:        ${files.length}  (${sourceRoot})`);
console.log(`${dryRun ? "Would copy:              " : "Copied and verified:     "} ${report.copied.length}  (${(report.bytesCopied / 1024 / 1024).toFixed(1)} MB)`);
console.log(`Already in bucket, same:  ${report.alreadyThere.length}`);
console.log(`In bucket but DIFFERENT:  ${report.differentInBucket.length}${report.differentInBucket.length ? "  (left alone; use --overwrite only if the local copy is right)" : ""}`);
console.log(`Failed read-back check:   ${report.verifyFailed.length}`);
console.log(`Report written to ${file}`);
if (report.differentInBucket.length || report.verifyFailed.length) {
  console.error("\nNot clean: do not switch SCRIPTORIUM_STORAGE_BACKEND to s3 yet.");
  process.exit(1);
}
console.log(dryRun ? "\nDry run complete: nothing was written." : "\nAll files are in the bucket and verified. The local folder was not touched.");
