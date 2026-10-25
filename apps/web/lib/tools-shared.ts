// Shared types and helpers for the Scholarly tools panel sections.
import type { ReadingNoteCandidate } from "./reading-notes-import";

export const DOCUMENT_KEY = "scriptorium.currentDocument";
export const PENDING_SPLIT_OCR_KEY = "scriptorium.pendingSplitOcr";
export const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type CurrentDocumentRef = {
  documentId?: string;
  versionId?: string;
  sourceId?: string;
  title?: string;
  basePdfPageIndex?: number;
  baseBookPage?: number;
};
export type PendingSplitOcr = { documentId: string; versionId: string; title: string; pageCount?: number };

export type ImportedReadingNoteRecord = {
  id: string;
  annotationId: string;
  citationId: string;
  selectedText: string;
  note: string;
  colorKey: string;
  pdfPageIndex: number;
  bookPageLabel: string;
  anchor?: ReadingNoteCandidate["anchor"];
  citationStyle: string;
  citationText: string;
  createdAt: string;
};

export function readCurrentDocumentRef(): CurrentDocumentRef {
  try {
    const raw = localStorage.getItem(DOCUMENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      title?: string;
      pageMap?: { basePdfPageIndex?: number; baseBookPage?: number };
      server?: { documentId?: string; versionId?: string; sourceId?: string };
    };
    return {
      documentId: parsed.server?.documentId,
      versionId: parsed.server?.versionId,
      sourceId: parsed.server?.sourceId,
      title: parsed.title,
      basePdfPageIndex: parsed.pageMap?.basePdfPageIndex,
      baseBookPage: parsed.pageMap?.baseBookPage
    };
  } catch {
    return {};
  }
}

export function readPendingSplitOcr(): PendingSplitOcr | null {
  try {
    const raw = localStorage.getItem(PENDING_SPLIT_OCR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingSplitOcr>;
    return parsed.documentId && parsed.versionId && parsed.title ? (parsed as PendingSplitOcr) : null;
  } catch {
    return null;
  }
}

