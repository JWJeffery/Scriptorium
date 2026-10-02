// Backup -> wipe -> restore, against a running server with MySQL. DESTRUCTIVE:
// empties the database it is pointed at, so it only runs in CI or on a scratch DB.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { textPdf } from "./lib-test-pdf.mjs";

if (process.env.SCRIPTORIUM_ALLOW_WIPE !== "yes") {
  console.error("Refusing to run: this test empties the database. Set SCRIPTORIUM_ALLOW_WIPE=yes on a scratch database.");
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromWeb = createRequire(path.join(repoRoot, "apps/web/package.json"));
const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
const { PrismaClient } = requireFromWeb("@prisma/client");
const yauzl = requireFromWeb("yauzl");
const prisma = new PrismaClient();

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const json = async (response) => { assert.ok(response.ok, `${response.url} -> ${response.status}`); return await response.json(); };
const post = (path, body) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Data worth keeping: document, annotation with tags, citation, thread, page ranges.
const form = new FormData();
form.set("file", new File([await textPdf([["Backup page one", "Grace and truth."], ["Backup page two"]])], "backup.pdf", { type: "application/pdf" }));
form.set("title", "Backup fixture");
const uploaded = await json(await fetch(`${baseUrl}/api/milestone-one/files`, { method: "POST", body: form }));
const annotation = (await json(await post("/api/milestone-one/annotations", {
  documentId: uploaded.document.id, versionId: uploaded.version.id, sourceId: uploaded.source.id, pageMapId: uploaded.pageMap.id,
  colorKey: "teal", selectedText: "Grace and truth.", note: "keep", tags: ["alpha", "beta"], anchor: { selectedText: "Grace and truth.", pageNumber: 1, rects: [{ left: 1, top: 2, width: 3, height: 4 }] },
  citationStyle: "sbl-note", citationText: "Cite.", locatorValue: "1"
}))).annotation;
const thread = (await json(await post("/api/threads", { title: "Backup thread", tags: ["t"] }))).thread;
await json(await post("/api/threads/items", { threadId: thread.id, itemType: "ANNOTATION", itemId: annotation.id }));
await json(await fetch(`${baseUrl}/api/page-ranges`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId: uploaded.version.id, ranges: [{ startPdfPage: 1, endPdfPage: 1, system: "roman-lower", startValue: 3, prefix: "" }, { startPdfPage: 2, endPdfPage: null, system: "arabic", startValue: 1, prefix: "" }] }) }));
await json(await post("/api/bookmarks", { documentId: uploaded.document.id, pdfPage: 2, label: "Keep this place" }));
const pdfOnDisk = await (await fetch(`${baseUrl}/api/milestone-one/files/${uploaded.document.id}`)).arrayBuffer();

// Back up on the server, then download it.
const created = await post("/api/backup", {});
assert.equal(created.status, 201);
const { name, totals } = await created.json();
assert.match(name, /^scriptorium-backup-\d{8}-\d{6}\.zip$/);
assert.ok(totals.rows >= 8 && totals.files >= 1);
const list = await json(await fetch(`${baseUrl}/api/backup`));
assert.ok(list.backups.some((backup) => backup.name === name));
const zipBytes = Buffer.from(await (await fetch(`${baseUrl}/api/backup/download?name=${name}`)).arrayBuffer());
assert.equal(zipBytes.subarray(0, 2).toString(), "PK", "the download is a real ZIP");
assert.equal((await fetch(`${baseUrl}/api/backup/download?name=../../etc/passwd`)).status, 400, "path tricks are refused");
assert.equal((await fetch(`${baseUrl}/api/backup/download?name=scriptorium-backup-20000101-000000.zip`)).status, 404);
const streamed = Buffer.from(await (await fetch(`${baseUrl}/api/backup/download`)).arrayBuffer());
assert.equal(streamed.subarray(0, 2).toString(), "PK", "an on-the-fly backup also downloads");

const workDir = await mkdtemp(path.join(os.tmpdir(), "scriptorium-restore-"));
const zipFile = path.join(workDir, "backup.zip");
await writeFile(zipFile, zipBytes);

// A damaged backup must be refused.
const damaged = Buffer.from(zipBytes);
damaged[Math.floor(damaged.length / 3)] ^= 0xff;
const damagedFile = path.join(workDir, "damaged.zip");
await writeFile(damagedFile, damaged);

// Row counts before the wipe: the database may hold data from earlier tests too.
const MODELS = ["document", "documentVersion", "source", "pageMap", "pageRange", "bookmark", "textSpan", "annotation", "annotationTag", "citation", "researchThread", "researchThreadTag", "researchThreadItem"];
const before = {};
for (const model of MODELS) before[model] = await prisma[model].count();

// Wipe everything (children first).
for (const model of ["researchThreadItem", "researchThreadTag", "researchThread", "citation", "annotationTag", "annotation", "textSpan", "bookmark", "pageRange", "pageMap", "source", "documentVersion", "document"]) await prisma[model].deleteMany();
assert.equal(await prisma.document.count(), 0);

const restoreEnv = { ...process.env, SCRIPTORIUM_STORAGE_DIR: path.join(workDir, "storage") };
const run = (file) => execFileSync("node", [path.join(repoRoot, "scripts/restore-backup.mjs"), file], { env: restoreEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let damagedRefused = false;
try { run(damagedFile); } catch (error) { damagedRefused = /Checksum mismatch|damaged|Missing|not a Scriptorium|zip/i.test(`${error.stdout}${error.stderr}${error.message}`); }
assert.ok(damagedRefused, "a damaged backup is refused");
assert.equal(await prisma.document.count(), 0, "a refused restore leaves the database untouched");

const output = run(zipFile);
assert.match(output, /Row counts match the backup for every table/);

// Compare what came back.
for (const model of MODELS) assert.equal(await prisma[model].count(), before[model], `${model}: every row is back`);
const restoredAnnotation = await prisma.annotation.findUnique({ where: { id: annotation.id }, include: { tags: true, citations: true } });
assert.deepEqual(restoredAnnotation.tags.map((tag) => tag.value).sort(), ["alpha", "beta"]);
assert.equal(restoredAnnotation.citations[0].generatedText, "Cite.");
assert.deepEqual(restoredAnnotation.anchor.rects[0], { left: 1, top: 2, width: 3, height: 4 }, "JSON columns survive");
assert.equal((await prisma.researchThreadItem.findMany({ where: { researchThreadId: thread.id } })).length, 1);
const ranges = await prisma.pageRange.findMany({ where: { versionId: uploaded.version.id }, orderBy: { startPdfPage: "asc" } });
assert.deepEqual(ranges.map((range) => `${range.system}:${range.startValue}`), ["roman-lower:3", "arabic:1"]);
assert.equal((await prisma.bookmark.findMany({ where: { documentId: uploaded.document.id } })).map((b) => `${b.pdfPage}:${b.label}`).join(), "2:Keep this place", "bookmarks survive");
const spans = await prisma.textSpan.findMany({ where: { versionId: uploaded.version.id } });
assert.ok(spans.some((span) => span.text.includes("Grace and truth")), "extracted page text survives");

const restoredPdf = await readFile(path.join(workDir, "storage", uploaded.document.storageKey ?? (await prisma.document.findFirst()).storageKey));
assert.equal(createHash("sha256").update(restoredPdf).digest("hex"), createHash("sha256").update(Buffer.from(pdfOnDisk)).digest("hex"), "the PDF is byte-for-byte identical");

// Restoring into a non-empty database is refused.
let nonEmptyRefused = false;
try { run(zipFile); } catch (error) { nonEmptyRefused = /already contains/.test(`${error.stdout}${error.stderr}`); }
assert.ok(nonEmptyRefused, "restore refuses a database that already has data");

await fetch(`${baseUrl}/api/backup?name=${name}`, { method: "DELETE" });
await rm(workDir, { recursive: true, force: true });
await prisma.$disconnect();
console.log("Backup verified: ZIP created and downloaded, damaged copy refused, database wiped and fully restored, PDF identical, non-empty restore refused.");
