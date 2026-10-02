#!/usr/bin/env node
// Restore a Scriptorium backup (.zip made by Scholarly tools > Backup) into an
// EMPTY database and storage folder.
//
//   node scripts/restore-backup.mjs path/to/scriptorium-backup-YYYYMMDD-HHMMSS.zip
//
// Reads DATABASE_URL and SCRIPTORIUM_STORAGE_DIR from the environment or the
// repository's .env. It first checks every checksum in the backup and refuses
// to touch anything if one is wrong, and it refuses to run on a database that
// already contains documents.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromWeb = createRequire(path.join(repoRoot, "apps/web/package.json"));
const yauzl = requireFromWeb("yauzl");
const { PrismaClient } = requireFromWeb("@prisma/client");

// Minimal .env loader (KEY="value") so the script works without extra tooling.
const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

const zipPath = process.argv[2];
if (!zipPath) { console.error("Usage: node scripts/restore-backup.mjs <backup.zip>"); process.exit(2); }

const storageRoot = path.resolve(repoRoot, process.env.SCRIPTORIUM_STORAGE_DIR ?? "./storage");
const TABLE_ORDER = ["Document", "DocumentVersion", "Source", "PageMap", "PageRange", "TextSpan", "Annotation", "AnnotationTag", "Citation", "ResearchThread", "ResearchThreadTag", "ResearchThreadItem"];
const DELEGATE = { Document: "document", DocumentVersion: "documentVersion", Source: "source", PageMap: "pageMap", PageRange: "pageRange", TextSpan: "textSpan", Annotation: "annotation", AnnotationTag: "annotationTag", Citation: "citation", ResearchThread: "researchThread", ResearchThreadTag: "researchThreadTag", ResearchThreadItem: "researchThreadItem" };

function openZip() {
  return new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, zip) => (error ? reject(error) : resolve(zip))));
}
function listEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = new Map();
    zip.on("entry", (entry) => { entries.set(entry.fileName, entry); zip.readEntry(); });
    zip.on("end", () => resolve(entries));
    zip.on("error", reject);
    zip.readEntry();
  });
}
const streamOf = (zip, entry) => new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream))));
async function readAll(zip, entry) {
  const chunks = [];
  for await (const chunk of await streamOf(zip, entry)) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function sha256Of(zip, entry) {
  const hash = createHash("sha256");
  for await (const chunk of await streamOf(zip, entry)) hash.update(chunk);
  return hash.digest("hex");
}

const zip = await openZip();
const entries = await listEntries(zip);
const manifestEntry = entries.get("manifest.json");
if (!manifestEntry) { console.error("This is not a Scriptorium backup (manifest.json is missing)."); process.exit(1); }
const manifest = JSON.parse((await readAll(zip, manifestEntry)).toString("utf8"));
if (manifest.app !== "scriptorium" || manifest.backupFormat !== 1) { console.error("Unsupported backup format."); process.exit(1); }

// 1. Verify everything before touching anything.
console.log(`Backup from ${manifest.createdAt}: ${manifest.totals.rows} rows, ${manifest.totals.files} files. Checking checksums…`);
for (const table of TABLE_ORDER) {
  const entry = entries.get(`database/${table}.ndjson`);
  if (!entry) { console.error(`Missing database/${table}.ndjson`); process.exit(1); }
  if ((await sha256Of(zip, entry)) !== manifest.tables[table].sha256) { console.error(`Checksum mismatch in ${table}. The backup is damaged; nothing was restored.`); process.exit(1); }
}
for (const file of manifest.files) {
  const entry = entries.get(`files/${file.key}`);
  if (!entry || (await sha256Of(zip, entry)) !== file.sha256) { console.error(`Checksum mismatch or missing file: ${file.key}. Nothing was restored.`); process.exit(1); }
}
console.log("All checksums match.");

// 2. Refuse to merge into a database that already has data.
const prisma = new PrismaClient();
const existing = await prisma.document.count();
if (existing > 0) { console.error(`The database already contains ${existing} document(s). Restore only works into an empty database.`); await prisma.$disconnect(); process.exit(1); }

// 3. Files.
let filesWritten = 0;
for (const file of manifest.files) {
  const target = path.resolve(storageRoot, file.key);
  if (!target.startsWith(storageRoot + path.sep)) { console.error(`Unsafe file path in backup: ${file.key}`); process.exit(1); }
  await mkdir(path.dirname(target), { recursive: true });
  const present = await stat(target).then(() => true, () => false);
  if (present) {
    const sha = createHash("sha256").update(await readFile(target)).digest("hex");
    if (sha === file.sha256) continue;
    console.error(`${file.key} already exists in storage with different contents; refusing to overwrite.`); process.exit(1);
  }
  await writeFile(target, await readAll(zip, entries.get(`files/${file.key}`)));
  filesWritten += 1;
}

// 4. Database.
const reviveDates = (row) => {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null) continue; // omitted columns take their NULL/default
    out[key] = /At$/.test(key) && typeof value === "string" ? new Date(value) : value;
  }
  return out;
};
let rowsRestored = 0;
const supersedes = [];
for (const table of TABLE_ORDER) {
  const delegate = prisma[DELEGATE[table]];
  const lines = createInterface({ input: await streamOf(zip, entries.get(`database/${table}.ndjson`)), crlfDelay: Infinity });
  let batch = [];
  let bytes = 0;
  const flush = async () => { if (batch.length) { await delegate.createMany({ data: batch }); rowsRestored += batch.length; batch = []; bytes = 0; } };
  for await (const line of lines) {
    if (!line) continue;
    const row = reviveDates(JSON.parse(line));
    if (table === "Citation" && row.supersedesCitationId) { supersedes.push([row.id, row.supersedesCitationId]); delete row.supersedesCitationId; }
    batch.push(row);
    bytes += line.length;
    if (batch.length >= 100 || bytes > 2_000_000) await flush();
  }
  await flush();
}
for (const [id, supersedesCitationId] of supersedes) await prisma.citation.update({ where: { id }, data: { supersedesCitationId } });

// 5. Prove it.
for (const table of TABLE_ORDER) {
  const count = await prisma[DELEGATE[table]].count();
  if (count !== manifest.tables[table].rows) { console.error(`${table}: restored ${count} rows but the backup has ${manifest.tables[table].rows}.`); await prisma.$disconnect(); process.exit(1); }
}
await prisma.$disconnect();
zip.close();
console.log(`Restored ${rowsRestored} rows and ${filesWritten} files. Row counts match the backup for every table.`);
