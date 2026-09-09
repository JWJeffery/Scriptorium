import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

// pnpm runs a filtered package script from apps/web, while other launch
// paths can start Next from the repository root. Using process.cwd()
// directly therefore made the same relative "./storage" setting point at
// two different directories across restarts. Normalize both launch shapes
// to the repository root so new writes always land in one stable place.
function repositoryRootFromCwd() {
  const cwd = path.resolve(process.cwd());
  return path.basename(cwd) === "web" && path.basename(path.dirname(cwd)) === "apps" ? path.resolve(cwd, "../..") : cwd;
}

const REPOSITORY_ROOT = repositoryRootFromCwd();
const DEFAULT_STORAGE_DIR = path.join(REPOSITORY_ROOT, "storage");
const MAX_PDF_BYTES = 75 * 1024 * 1024;
const MAX_TEXT_SNAPSHOT_BYTES = 10 * 1024 * 1024;

export type StoredPdfFile = {
  storageKey: string;
  size: number;
};

export type StoredTextSnapshot = {
  storageKey: string;
  size: number;
  checksum: string;
  text: string;
  lineCount: number;
};

function safeSegment(value: string, fallback: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned;
}

function safeFilename(filename: string) {
  const cleaned = safeSegment(filename, "document.pdf");
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

function safeDocumentId(documentId: string) {
  return safeSegment(documentId, "document");
}

export function safeStorageSegment(value: string, fallback: string) {
  return safeSegment(value, fallback);
}

function safeChecksum(checksum: string) {
  return /^[a-f0-9]{64}$/i.test(checksum) ? checksum.toLowerCase() : "snapshot";
}

// Deliberately generic - a small key/value JSON blob under an arbitrary,
// already-sanitized-by-the-caller storage key. Exists for
// page-split-jobs.ts, which needs to persist a completed job's result
// (which storage key holds the output PDF, how many pages split) to
// somewhere that survives a Next.js dev-mode module reload - unlike an
// in-memory Map, which turned out to get cleared by exactly that in
// practice (confirmed directly: a real "download not found" after a
// visibly-completed split, with dev-mode Fast Refresh rebuilds in the
// browser console at the same time). Reuses this file's existing
// path-safety handling instead of duplicating it in a second module.
export async function writeStorageJson(storageKey: string, value: unknown): Promise<void> {
  const absolutePath = resolveStorageKey(storageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(value), "utf8");
}

export async function readStorageJson<T>(storageKey: string): Promise<T | null> {
  try {
    const raw = (await readStorageFile(storageKey)).toString("utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteStorageFile(storageKey: string): Promise<void> {
  await Promise.all(storageRootCandidates().map((root) => unlink(resolveStorageKeyAtRoot(root, storageKey)).catch(() => undefined)));
}

export function getStorageRoot() {
  const configured = process.env.SCRIPTORIUM_STORAGE_DIR?.trim();
  if (!configured) return DEFAULT_STORAGE_DIR;
  return path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(REPOSITORY_ROOT, configured);
}

function resolveStorageKeyAtRoot(storageRoot: string, storageKey: string) {
  if (path.isAbsolute(storageKey)) {
    throw new Error("Invalid storage key.");
  }

  const absolutePath = path.resolve(storageRoot, storageKey);
  const relativePath = path.relative(storageRoot, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid storage key.");
  }

  return absolutePath;
}

function resolveStorageKey(storageKey: string) {
  return resolveStorageKeyAtRoot(getStorageRoot(), storageKey);
}

// Reads remain compatible with both locations used by older launch paths.
// This recovers a document whose database storageKey is valid but whose
// bytes were written under apps/web/storage before a later restart began
// resolving ./storage from the repository root (or vice versa).
function storageRootCandidates() {
  return Array.from(
    new Set(
      [
        getStorageRoot(),
        path.join(REPOSITORY_ROOT, "storage"),
        path.join(REPOSITORY_ROOT, "apps", "web", "storage"),
        path.resolve(process.cwd(), "storage")
      ].map((candidate) => path.resolve(candidate))
    )
  );
}

async function readStorageFile(storageKey: string) {
  let notFound: NodeJS.ErrnoException | undefined;
  const primaryRoot = getStorageRoot();
  for (const root of storageRootCandidates()) {
    try {
      const contents = await readFile(resolveStorageKeyAtRoot(root, storageKey));
      if (root !== primaryRoot) {
        // Self-heal the first successful legacy lookup. Future reads use the
        // stable primary path, but the legacy copy is left untouched until a
        // person deliberately cleans it up.
        const primaryPath = resolveStorageKeyAtRoot(primaryRoot, storageKey);
        await mkdir(path.dirname(primaryPath), { recursive: true });
        await writeFile(primaryPath, contents).catch(() => undefined);
      }
      return contents;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        notFound = error as NodeJS.ErrnoException;
        continue;
      }
      throw error;
    }
  }
  throw notFound ?? Object.assign(new Error(`Stored file not found: ${storageKey}`), { code: "ENOENT" });
}

export function normalizeTextSnapshot(rawText: string) {
  return rawText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function textSnapshotChecksum(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function storePdfFile(documentId: string, file: File): Promise<StoredPdfFile> {
  if (file.type !== "application/pdf") {
    throw new Error("Only PDF files are accepted for Milestone 1.");
  }

  if (file.size > MAX_PDF_BYTES) {
    throw new Error("PDF exceeds the Milestone 1 upload size limit.");
  }

  const documentSegment = safeDocumentId(documentId);
  const filename = safeFilename(file.name);
  const storageKey = `documents/${documentSegment}/${filename}`;
  const documentDirectory = resolveStorageKey(`documents/${documentSegment}`);
  const absolutePath = resolveStorageKey(storageKey);
  const buffer = Buffer.from(await file.arrayBuffer());

  await mkdir(documentDirectory, { recursive: true });
  await writeFile(absolutePath, buffer);

  return { storageKey, size: buffer.byteLength };
}

export async function storeTextSnapshot(documentId: string, rawText: string): Promise<StoredTextSnapshot> {
  const text = normalizeTextSnapshot(rawText);
  const buffer = Buffer.from(text, "utf8");

  if (buffer.byteLength > MAX_TEXT_SNAPSHOT_BYTES) {
    throw new Error("Text snapshot exceeds the upload size limit.");
  }

  if (!text.trim()) {
    throw new Error("Text snapshot is empty.");
  }

  const checksum = textSnapshotChecksum(text);
  const documentSegment = safeDocumentId(documentId);
  const checksumSegment = safeChecksum(checksum);
  const storageKey = `documents/${documentSegment}/snapshots/${checksumSegment}.txt`;
  const snapshotDirectory = resolveStorageKey(`documents/${documentSegment}/snapshots`);
  const absolutePath = resolveStorageKey(storageKey);

  await mkdir(snapshotDirectory, { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    storageKey,
    size: buffer.byteLength,
    checksum,
    text,
    lineCount: text.split("\n").length
  };
}

export async function readStoredPdfFile(storageKey: string) {
  return await readStorageFile(storageKey);
}

export async function readStoredTextSnapshot(storageKey: string) {
  return (await readStorageFile(storageKey)).toString("utf8");
}

export async function deleteStoredPdfFile(storageKey: string) {
  await deleteStorageFile(storageKey);
}

export type StoredFileEntry = { storageKey: string; size: number; modifiedAt: string };

/**
 * Recursively list every file under the storage root, relative to it. This
 * is the backbone of the corpus export manifest (Milestone 15): the
 * database export covers metadata/annotations/citations, but the PDF
 * originals and text snapshots live on disk, so a full backup needs both.
 */
export async function listStoredFiles(): Promise<StoredFileEntry[]> {
  const entries = new Map<string, StoredFileEntry>();

  async function walk(storageRoot: string, relativeDir: string) {
    const absoluteDir = resolveStorageKeyAtRoot(storageRoot, relativeDir);
    let dirEntries;
    try {
      dirEntries = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of dirEntries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(storageRoot, relativePath);
        continue;
      }
      if (entries.has(relativePath)) continue;
      const info = await stat(resolveStorageKeyAtRoot(storageRoot, relativePath));
      entries.set(relativePath, { storageKey: relativePath, size: info.size, modifiedAt: info.mtime.toISOString() });
    }
  }

  for (const root of storageRootCandidates()) await walk(root, "");
  return Array.from(entries.values()).sort((a, b) => a.storageKey.localeCompare(b.storageKey));
}
