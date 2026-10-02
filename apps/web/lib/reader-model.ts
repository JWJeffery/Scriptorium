import type { CitationStyleId, CslItem } from "./citation-styles";
import { formatCitation } from "./citation-styles";
import type { PdfSelectionAnchor } from "../components/PdfAnchoredPageReader";
import type { TextSelectionAnchor } from "../components/TextAnchoredReader";
import type { PageRangeSpec } from "./page-labels";
import { labelForPage } from "./page-labels";
import { parseAuthors } from "./author-names";




// Types, constants and helper functions for the reading workspace (kept out of the component file).
export type CitationStyle = CitationStyleId;
export type DocumentKind = "PDF" | "TXT" | "MARKDOWN" | "DOCX";
export type SourceRecord = { author: string; title: string; place: string; publisher: string; year: string };
export type PageMap = { basePdfPageIndex: number; baseBookPage: number; currentPdfPageIndex: number };
export type ServerIds = { documentId: string; versionId: string; sourceId: string; pageMapId: string; storageKey?: string; snapshotKey?: string; sourceChecksum?: string };
export type StoredDocument = { id: string; title: string; filename: string; kind: DocumentKind; mediaType: string; size: number; source: SourceRecord; pageMap: PageMap; server?: ServerIds };
export type SelectionAnchor = PdfSelectionAnchor | TextSelectionAnchor;
export type SavedAnnotation = { id: string; documentId: string; versionId?: string; snapshotKey?: string; colorKey: string; selectedText: string; note: string; pdfPageIndex: number; bookPageLabel: string; citationStyle: CitationStyle; citationText: string; anchor?: SelectionAnchor; createdAt: string; serverAnnotationId?: string; serverCitationId?: string; tags?: string[] };

export type TextPersistResponse = {
  document: { id: string; storageKey?: string | null };
  version: { id: string; sourceChecksum?: string | null; snapshotKey?: string | null };
  source: { id: string };
  pageMap: { id: string };
  textSpan: { text: string };
  storedSnapshot?: { storageKey: string; checksum: string };
};

export type SourceUpdateResponse = {
  source: {
    id: string;
    shortTitle?: string | null;
    cslJson?: unknown;
  };
};

export const DB_NAME = "scriptorium-file-store";
export const DB_VERSION = 1;
export const PDF_STORE = "pdf-blobs";
export const DOCUMENT_KEY = "scriptorium.currentDocument";
export const TEXT_CONTENT_KEY = "scriptorium.currentTextContent";
export const ANNOTATIONS_KEY = "scriptorium.annotations";
export const LAST_PAGES_KEY = "scriptorium.lastPages";
export const DRAFT_KEY = "scriptorium.draft";
export const INSPECTOR_PIN_KEY = "scriptorium.ui.inspectorPinned";
export const PENDING_SPLIT_OCR_KEY = "scriptorium.pendingSplitOcr";
export const PENDING_JUMP_KEY = "scriptorium.pendingJump";
export const EMPTY_SOURCE: SourceRecord = { author: "", title: "", place: "", publisher: "", year: "" };
export const DEFAULT_PAGE_MAP: PageMap = { basePdfPageIndex: 1, baseBookPage: 1, currentPdfPageIndex: 1 };
export const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function localId(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
export function bookPage(pageMap: PageMap) { return String(pageMap.baseBookPage + pageMap.currentPdfPageIndex - pageMap.basePdfPageIndex); }
export function bytes(size: number) { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }
export function serverPdfUrl(document: StoredDocument) { return document.server?.storageKey ? `/api/core/files/${document.server.documentId}` : null; }
export function isPdf(document: StoredDocument | null) { return document?.kind === "PDF"; }
export function isText(document: StoredDocument | null): document is StoredDocument & { kind: "TXT" | "MARKDOWN" | "DOCX" } { return document?.kind === "TXT" || document?.kind === "MARKDOWN" || document?.kind === "DOCX"; }
export function isTextAnchor(anchor: SelectionAnchor | undefined): anchor is TextSelectionAnchor { return typeof anchor === "object" && anchor !== null && "startOffset" in anchor && "lineStart" in anchor; }
export function lineLocator(anchor: TextSelectionAnchor) { return anchor.lineStart === anchor.lineEnd ? String(anchor.lineStart) : `${anchor.lineStart}-${anchor.lineEnd}`; }
export function normalizeTextSnapshot(text: string) { return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"); }
export function mediaTypeFor(kind: DocumentKind, file: File) { return file.type || (kind === "PDF" ? "application/pdf" : kind === "MARKDOWN" ? "text/markdown" : kind === "DOCX" ? DOCX_MEDIA_TYPE : "text/plain"); }
export function formatFor(kind: DocumentKind) { return kind === "MARKDOWN" ? "Markdown" : kind === "TXT" ? "TXT" : kind === "DOCX" ? "DOCX" : "PDF"; }
export function titleFromFilename(fileName: string) { return fileName.replace(/\.(pdf|txt|md|markdown|docx)$/i, ""); }

export function fileKind(file: File): DocumentKind | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (file.type === "text/markdown" || name.endsWith(".md") || name.endsWith(".markdown")) return "MARKDOWN";
  if (file.type === "text/plain" || name.endsWith(".txt")) return "TXT";
  if (file.type === DOCX_MEDIA_TYPE || name.endsWith(".docx")) return "DOCX";
  return null;
}

export function citation(document: StoredDocument, locator: string, style: CitationStyle) {
  const source = document.source;
  const numericYear = Number(source.year);
  const item: CslItem = {
    type: "book",
    title: source.title.trim() || document.title,
    author: source.author.trim() ? (parseAuthors(source.author.trim()) as CslItem["author"]) : undefined,
    publisher: source.publisher.trim() || undefined,
    "publisher-place": source.place.trim() || undefined,
    issued: source.year.trim()
      ? { "date-parts": [[Number.isFinite(numericYear) ? numericYear : source.year.trim()]] }
      : undefined
  };
  // The canonical formatter is shared with citation regeneration. Its
  // italic markers are stripped here because saved annotation citations are
  // intentionally plain text rather than trusted HTML.
  return formatCitation(item, style, { type: isText(document) ? "line" : "page", value: locator }).replace(/<\/?i>/g, "");
}

// CSL JSON built from the Source metadata form (used when the form has edits that are not saved yet).
export function cslFromForm(document: StoredDocument) {
  const source = document.source;
  const year = Number(source.year);
  return {
    type: "book",
    title: source.title.trim() || document.title,
    author: source.author.trim() ? parseAuthors(source.author.trim()) : undefined,
    publisher: source.publisher.trim() || undefined,
    "publisher-place": source.place.trim() || undefined,
    issued: source.year.trim() ? { "date-parts": [[Number.isFinite(year) ? year : source.year.trim()]] } : undefined
  };
}

export type EngineCitation = { text: string; missing: string[] };

// Format with the official citation style files on the server. Returns null if
// the server cannot (the caller falls back to the built-in formatter).
export async function formatViaEngine(document: StoredDocument, locator: string, style: CitationStyle, unsavedSource: boolean): Promise<EngineCitation | null> {
  try {
    const source = document.server?.sourceId && !unsavedSource ? { sourceId: document.server.sourceId } : { csl: cslFromForm(document) };
    const response = await fetch("/api/cite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ style, mode: "each", items: [{ ...source, locator: locator && locator !== "-" ? locator : undefined, label: isText(document) ? "line" : "page" }] })
    });
    if (!response.ok) return null;
    const body = await response.json() as { citations: Array<{ text: string }>; missing: string[] };
    return { text: body.citations[0].text, missing: body.missing };
  } catch {
    return null;
  }
}

export function normalizeDocument(value: unknown) {
  const parsed = value as Partial<StoredDocument> | null;
  if (!parsed?.id || !parsed.title || !parsed.filename || !parsed.mediaType || !parsed.source || !parsed.pageMap) return null;
  return { ...parsed, kind: parsed.kind ?? "PDF" } as StoredDocument;
}

export function validateSource(source: SourceRecord) {
  if (!source.title.trim()) return "A source title is required before saving CSL metadata.";
  if (source.year.trim() && !/^\d{1,4}$/.test(source.year.trim())) return "Year must be a 1-4 digit year.";
  return null;
}

export function readDocument() { const raw = localStorage.getItem(DOCUMENT_KEY); return raw ? normalizeDocument(JSON.parse(raw)) : null; }
export function readAnnotations() { const raw = localStorage.getItem(ANNOTATIONS_KEY); return raw ? (JSON.parse(raw) as SavedAnnotation[]) : []; }
export function saveDocument(document: StoredDocument) { localStorage.setItem(DOCUMENT_KEY, JSON.stringify(document)); }
export function saveTextContent(text: string) { localStorage.setItem(TEXT_CONTENT_KEY, text); }
export function readTextContent() { return localStorage.getItem(TEXT_CONTENT_KEY) ?? ""; }
export type WorkspaceBody = { document: { versions: Array<{ id: string; snapshotKey?: string | null; annotations: Array<{ id: string; versionId: string; colorKey: string; selectedText: string; note: string | null; anchor: unknown; createdAt: string; tags?: Array<{ value: string }>; citations: Array<{ id: string; styleId: string; locatorValue: string | null; generatedText: string }> }> }> } };

export function recordsFromWorkspace(body: WorkspaceBody, documentId: string, fallbackPage: number): SavedAnnotation[] {
  return body.document.versions.flatMap((version) => version.annotations.map((item): SavedAnnotation => {
    const itemCitation = item.citations[0];
    const itemAnchor = (item.anchor ?? undefined) as SelectionAnchor | undefined;
    return {
      id: `server_${item.id}`,
      documentId,
      versionId: item.versionId,
      snapshotKey: version.snapshotKey ?? undefined,
      colorKey: item.colorKey,
      selectedText: item.selectedText,
      note: item.note ?? "",
      pdfPageIndex: itemAnchor && !isTextAnchor(itemAnchor) ? itemAnchor.pageNumber : fallbackPage,
      bookPageLabel: itemCitation?.locatorValue ?? "",
      citationStyle: (itemCitation?.styleId ?? "sbl-note") as CitationStyle,
      citationText: itemCitation?.generatedText ?? "",
      anchor: itemAnchor,
      createdAt: item.createdAt,
      serverAnnotationId: item.id,
      serverCitationId: itemCitation?.id,
      tags: (item.tags ?? []).map((tag) => tag.value)
    };
  }));
}

// What the database holds for one book, or null if it cannot be reached.
export async function fetchServerRecords(documentId: string, fallbackPage: number) {
  try {
    const response = await fetch(`/api/core/workspace?documentId=${encodeURIComponent(documentId)}`);
    if (!response.ok) return null;
    const body = await response.json() as WorkspaceBody;
    return { records: recordsFromWorkspace(body, documentId, fallbackPage), versionIds: new Set(body.document.versions.map((version) => version.id)) };
  } catch {
    return null;
  }
}

export function readLastPages(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(LAST_PAGES_KEY) ?? "{}") as Record<string, number>; } catch { return {}; }
}
export function rememberLastPage(documentId: string, page: number) {
  try {
    const pages = readLastPages();
    pages[documentId] = page;
    const keys = Object.keys(pages);
    if (keys.length > 200) delete pages[keys[0]];
    localStorage.setItem(LAST_PAGES_KEY, JSON.stringify(pages));
  } catch { /* a reading convenience only */ }
}

export function saveAnnotations(records: SavedAnnotation[]) { localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(records)); }

export function currentLocator(document: StoredDocument | null, anchor: SelectionAnchor | undefined, ranges?: PageRangeSpec[] | null) {
  if (!document) return "-";
  if (isText(document) && isTextAnchor(anchor)) return lineLocator(anchor);
  if (isText(document)) return "1";
  // Printed numbering saved for this book (Roman preface, appendix, ...). An
  // unnumbered page has no label, so the citation simply omits the page.
  if (ranges && ranges.length > 0) return labelForPage(ranges, document.pageMap.currentPdfPageIndex) ?? "";
  return bookPage(document.pageMap);
}

export function locatorTypeFor(document: StoredDocument, anchor: SelectionAnchor | undefined) { return isText(document) && isTextAnchor(anchor) ? "line" : "page"; }
export function recordMatchesCurrentVersion(record: SavedAnnotation, document: StoredDocument | null) { const currentVersionId = document?.server?.versionId; return currentVersionId ? record.versionId ? record.versionId === currentVersionId : true : true; }

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(PDF_STORE)) request.result.createObjectStore(PDF_STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putPdf(documentId: string, file: File) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE, "readwrite");
    transaction.objectStore(PDF_STORE).put(file, documentId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function getPdf(documentId: string) {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE, "readonly");
    const request = transaction.objectStore(PDF_STORE).get(documentId);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

export async function persistDocument(document: StoredDocument, locator: string) {
  const response = await fetch("/api/core/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: document.title, filename: document.filename, mediaType: document.mediaType, size: document.size, source: document.source, pageMap: { ...document.pageMap, bookPageLabel: locator } })
  });
  if (!response.ok) throw new Error("Document persistence failed.");
  const body = await response.json() as { document: { id: string }; version: { id: string }; source: { id: string }; pageMap: { id: string } };
  return { documentId: body.document.id, versionId: body.version.id, sourceId: body.source.id, pageMapId: body.pageMap.id } satisfies ServerIds;
}

export async function persistPdfFile(file: File, document: StoredDocument, locator: string) {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("title", document.title);
  formData.set("author", document.source.author);
  formData.set("place", document.source.place);
  formData.set("publisher", document.source.publisher);
  formData.set("year", document.source.year);
  formData.set("basePdfPageIndex", String(document.pageMap.basePdfPageIndex));
  formData.set("baseBookPage", String(document.pageMap.baseBookPage));
  formData.set("currentPdfPageIndex", String(document.pageMap.currentPdfPageIndex));
  formData.set("bookPageLabel", locator);
  const response = await fetch("/api/core/files", { method: "POST", body: formData });
  if (!response.ok) throw new Error("PDF upload persistence failed.");
  const body = await response.json() as { document: { id: string; storageKey?: string | null }; version: { id: string }; source: { id: string }; pageMap: { id: string }; storedFile?: { storageKey: string } };
  return { documentId: body.document.id, versionId: body.version.id, sourceId: body.source.id, pageMapId: body.pageMap.id, storageKey: body.storedFile?.storageKey ?? body.document.storageKey ?? undefined } satisfies ServerIds;
}

export async function persistTextLikeFile(file: File, document: StoredDocument, locator: string, existingServerDocumentId?: string) {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("title", document.title);
  formData.set("author", document.source.author);
  formData.set("place", document.source.place);
  formData.set("publisher", document.source.publisher);
  formData.set("year", document.source.year);
  formData.set("bookPageLabel", locator);
  if (existingServerDocumentId) formData.set("documentId", existingServerDocumentId);
  const endpoint = document.kind === "DOCX" ? "/api/export/docx" : "/api/core/texts";
  const response = await fetch(endpoint, { method: "POST", body: formData });
  if (!response.ok) throw new Error("Text-like upload persistence failed.");
  const body = await response.json() as TextPersistResponse;
  return {
    server: {
      documentId: body.document.id,
      versionId: body.version.id,
      sourceId: body.source.id,
      pageMapId: body.pageMap.id,
      storageKey: body.document.storageKey ?? undefined,
      snapshotKey: body.version.snapshotKey ?? body.storedSnapshot?.storageKey ?? undefined,
      sourceChecksum: body.version.sourceChecksum ?? body.storedSnapshot?.checksum ?? undefined
    } satisfies ServerIds,
    text: body.textSpan.text
  };
}

export async function persistSourceMetadata(document: StoredDocument) {
  if (!document.server?.sourceId) throw new Error("Document has no persisted source id.");
  const response = await fetch("/api/sources", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceId: document.server.sourceId, ...document.source })
  });
  if (!response.ok) throw new Error("Source metadata persistence failed.");
  return await response.json() as SourceUpdateResponse;
}

export async function persistAnnotation(document: StoredDocument, record: SavedAnnotation) {
  if (!document.server) throw new Error("Document has no server ids.");
  const response = await fetch("/api/core/annotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId: document.server.documentId, versionId: document.server.versionId, sourceId: document.server.sourceId, pageMapId: document.server.pageMapId, colorKey: record.colorKey, selectedText: record.selectedText, note: record.note, tags: record.tags ?? [], anchor: record.anchor, citationStyle: record.citationStyle, citationText: record.citationText, locatorType: locatorTypeFor(document, record.anchor), locatorValue: record.bookPageLabel })
  });
  if (!response.ok) throw new Error("Annotation persistence failed.");
  return await response.json() as { annotation: { id: string }; citation: { id: string } };
}

