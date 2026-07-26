import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_STORAGE_DIR = path.join(process.cwd(), "storage");
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

function safeChecksum(checksum: string) {
  return /^[a-f0-9]{64}$/i.test(checksum) ? checksum.toLowerCase() : "snapshot";
}

export function getStorageRoot() {
  return path.resolve(process.env.SCRIPTORIUM_STORAGE_DIR || DEFAULT_STORAGE_DIR);
}

function resolveStorageKey(storageKey: string) {
  if (path.isAbsolute(storageKey)) {
    throw new Error("Invalid storage key.");
  }

  const storageRoot = getStorageRoot();
  const absolutePath = path.resolve(storageRoot, storageKey);
  const relativePath = path.relative(storageRoot, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid storage key.");
  }

  return absolutePath;
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
  const absolutePath = resolveStorageKey(storageKey);
  return await readFile(absolutePath);
}

export async function readStoredTextSnapshot(storageKey: string) {
  const absolutePath = resolveStorageKey(storageKey);
  return await readFile(absolutePath, "utf8");
}

export async function deleteStoredPdfFile(storageKey: string) {
  const absolutePath = resolveStorageKey(storageKey);
  await unlink(absolutePath).catch(() => undefined);
}

export type StoredFileEntry = { storageKey: string; size: number; modifiedAt: string };

/**
 * Recursively list every file under the storage root, relative to it. This
 * is the backbone of the corpus export manifest (Milestone 15): the
 * database export covers metadata/annotations/citations, but the PDF
 * originals and text snapshots live on disk, so a full backup needs both.
 */
export async function listStoredFiles(): Promise<StoredFileEntry[]> {
  const root = getStorageRoot();
  const entries: StoredFileEntry[] = [];

  async function walk(relativeDir: string) {
    const absoluteDir = resolveStorageKey(relativeDir);
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
        await walk(relativePath);
        continue;
      }
      const info = await stat(resolveStorageKey(relativePath));
      entries.push({ storageKey: relativePath, size: info.size, modifiedAt: info.mtime.toISOString() });
    }
  }

  await walk("");
  entries.sort((a, b) => a.storageKey.localeCompare(b.storageKey));
  return entries;
}
