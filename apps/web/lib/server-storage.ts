import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORAGE_DIR = path.join(process.cwd(), "storage");
const MAX_PDF_BYTES = 75 * 1024 * 1024;

export type StoredPdfFile = {
  storageKey: string;
  size: number;
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

export async function readStoredPdfFile(storageKey: string) {
  const absolutePath = resolveStorageKey(storageKey);
  return await readFile(absolutePath);
}

export async function deleteStoredPdfFile(storageKey: string) {
  const absolutePath = resolveStorageKey(storageKey);
  await unlink(absolutePath).catch(() => undefined);
}
