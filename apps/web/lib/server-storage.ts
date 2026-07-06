import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORAGE_DIR = path.join(process.cwd(), "storage");
const MAX_PDF_BYTES = 75 * 1024 * 1024;

export type StoredPdfFile = {
  storageKey: string;
  size: number;
};

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-") || "document.pdf";
}

export function getStorageRoot() {
  return process.env.SCRIPTORIUM_STORAGE_DIR || DEFAULT_STORAGE_DIR;
}

export async function storePdfFile(documentId: string, file: File): Promise<StoredPdfFile> {
  if (file.type !== "application/pdf") {
    throw new Error("Only PDF files are accepted for Milestone 1.");
  }

  if (file.size > MAX_PDF_BYTES) {
    throw new Error("PDF exceeds the Milestone 1 upload size limit.");
  }

  const storageRoot = getStorageRoot();
  const documentDirectory = path.join(storageRoot, "documents", documentId);
  await mkdir(documentDirectory, { recursive: true });

  const filename = safeFilename(file.name);
  const storageKey = `documents/${documentId}/${filename}`;
  const absolutePath = path.join(storageRoot, "documents", documentId, filename);
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(absolutePath, buffer);

  return { storageKey, size: buffer.byteLength };
}
