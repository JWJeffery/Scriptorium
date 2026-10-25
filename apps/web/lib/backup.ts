import { ZipArchive, type Archiver } from "archiver";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "./prisma";
import { getStorageRoot, listStoredFiles, readStoredPdfFile } from "./server-storage";

// A backup is one ZIP file:
//   database/<Table>.ndjson   one JSON object per line, every row of every table
//   files/<storage key>       the PDFs, text snapshots and other stored files
//   manifest.json             counts and SHA-256 checksums, written last
// scripts/restore-backup.mjs reads it back into an empty database + storage folder.

export const BACKUP_FORMAT = 1;
export const BACKUP_NAME_PATTERN = /^scriptorium-backup-\d{8}-\d{6}\.zip$/;
const KEEP_LATEST = 14;
const BATCH = 100;

type Delegate = { findMany: (args: { take: number; skip?: number; cursor?: { id: string }; orderBy: { id: "asc" } }) => Promise<Array<{ id: string }>> };

// Parents before children, so a restore can insert in this order.
const TABLES: Array<{ name: string; delegate: () => Delegate }> = [
  { name: "Document", delegate: () => prisma.document as unknown as Delegate },
  { name: "DocumentVersion", delegate: () => prisma.documentVersion as unknown as Delegate },
  { name: "Source", delegate: () => prisma.source as unknown as Delegate },
  { name: "PageMap", delegate: () => prisma.pageMap as unknown as Delegate },
  { name: "PageRange", delegate: () => prisma.pageRange as unknown as Delegate },
  { name: "Bookmark", delegate: () => prisma.bookmark as unknown as Delegate },
  { name: "TextSpan", delegate: () => prisma.textSpan as unknown as Delegate },
  { name: "Annotation", delegate: () => prisma.annotation as unknown as Delegate },
  { name: "AnnotationTag", delegate: () => prisma.annotationTag as unknown as Delegate },
  { name: "Citation", delegate: () => prisma.citation as unknown as Delegate },
  { name: "ResearchThread", delegate: () => prisma.researchThread as unknown as Delegate },
  { name: "ResearchThreadTag", delegate: () => prisma.researchThreadTag as unknown as Delegate },
  { name: "ResearchThreadItem", delegate: () => prisma.researchThreadItem as unknown as Delegate }
];

export type BackupManifest = {
  app: "scriptorium";
  backupFormat: number;
  createdAt: string;
  tables: Record<string, { rows: number; sha256: string }>;
  files: Array<{ key: string; size: number; sha256: string }>;
  totals: { rows: number; files: number; fileBytes: number };
};

export function backupDirectory() {
  const configured = process.env.SCRIPTORIUM_BACKUP_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(path.dirname(getStorageRoot()), "scriptorium-backups");
}

function stamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function appendAndWait(archive: Archiver, source: Readable | Buffer, name: string) {
  return new Promise<void>((resolve, reject) => {
    const onEntry = (entry: { name: string }) => { if (entry.name === name) { archive.off("entry", onEntry); resolve(); } };
    archive.on("entry", onEntry);
    archive.once("error", reject);
    archive.append(source, { name });
  });
}

// Rows are read a page at a time so a large library never sits in memory whole.
async function* tableLines(table: (typeof TABLES)[number], tally: { rows: number; hash: ReturnType<typeof createHash> }) {
  const delegate = table.delegate();
  let cursor: string | undefined;
  for (;;) {
    const rows = await delegate.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } });
    if (rows.length === 0) return;
    for (const row of rows) {
      const line = `${JSON.stringify(row)}\n`;
      tally.rows += 1;
      tally.hash.update(line);
      yield line;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < BATCH) return;
  }
}

/** Write the whole backup into an archive. Resolves with the manifest once everything is appended. */
export async function writeBackup(archive: Archiver): Promise<BackupManifest> {
  const manifest: BackupManifest = { app: "scriptorium", backupFormat: BACKUP_FORMAT, createdAt: new Date().toISOString(), tables: {}, files: [], totals: { rows: 0, files: 0, fileBytes: 0 } };

  for (const table of TABLES) {
    const tally = { rows: 0, hash: createHash("sha256") };
    await appendAndWait(archive, Readable.from(tableLines(table, tally)), `database/${table.name}.ndjson`);
    manifest.tables[table.name] = { rows: tally.rows, sha256: tally.hash.digest("hex") };
    manifest.totals.rows += tally.rows;
  }

  for (const file of await listStoredFiles()) {
    let bytes: Buffer;
    try { bytes = await readStoredPdfFile(file.storageKey); } catch { continue; } // vanished while backing up
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await appendAndWait(archive, bytes, `files/${file.storageKey}`);
    manifest.files.push({ key: file.storageKey, size: bytes.byteLength, sha256 });
    manifest.totals.files += 1;
    manifest.totals.fileBytes += bytes.byteLength;
  }

  await appendAndWait(archive, Buffer.from(JSON.stringify(manifest, null, 2)), "manifest.json");
  return manifest;
}

export function newArchive() {
  // Already-compressed PDFs gain little from deflate, so store level is modest.
  return new ZipArchive({ zlib: { level: 3 } });
}

/** Stream a fresh backup without keeping a copy on the server. */
export function backupStream(): Readable {
  const archive = newArchive();
  writeBackup(archive).then(() => archive.finalize()).catch((error) => archive.destroy(error instanceof Error ? error : new Error(String(error))));
  return archive;
}

/** Save a backup on the server, then trim old ones. */
export async function saveBackupOnServer() {
  const directory = backupDirectory();
  await mkdir(directory, { recursive: true });
  const name = `scriptorium-backup-${stamp(new Date())}.zip`;
  const finalPath = path.join(directory, name);
  const partialPath = `${finalPath}.partial`;

  const archive = newArchive();
  const output = createWriteStream(partialPath);
  const finished = new Promise<void>((resolve, reject) => { output.on("close", resolve); output.on("error", reject); archive.on("error", reject); });
  archive.pipe(output);
  try {
    const manifest = await writeBackup(archive);
    await archive.finalize();
    await finished;
    await rename(partialPath, finalPath);
    await trimBackups(directory);
    return { name, size: (await stat(finalPath)).size, manifest };
  } catch (error) {
    archive.destroy();
    await unlink(partialPath).catch(() => undefined);
    throw error;
  }
}

export async function listBackups() {
  const directory = backupDirectory();
  let names: string[] = [];
  try { names = await readdir(directory); } catch { return { directory, backups: [] as Array<{ name: string; size: number; createdAt: string }> }; }
  const backups = await Promise.all(names.filter((name) => BACKUP_NAME_PATTERN.test(name)).map(async (name) => {
    const info = await stat(path.join(directory, name));
    return { name, size: info.size, createdAt: info.mtime.toISOString() };
  }));
  return { directory, backups: backups.sort((a, b) => b.name.localeCompare(a.name)) };
}

async function trimBackups(directory: string) {
  const { backups } = await listBackups();
  for (const old of backups.slice(KEEP_LATEST)) await unlink(path.join(directory, old.name)).catch(() => undefined);
}

export function backupPath(name: string) {
  if (!BACKUP_NAME_PATTERN.test(name)) throw new Error("Invalid backup name.");
  return path.join(backupDirectory(), name);
}
