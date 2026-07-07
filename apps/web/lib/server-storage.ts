import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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
