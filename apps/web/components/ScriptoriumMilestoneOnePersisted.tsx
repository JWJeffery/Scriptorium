"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCitation, type CitationStyleId, type CslItem } from "../lib/citation-styles";
import { highlightColors } from "../lib/highlights";
import { PdfAnchoredPageReader, type PdfAuthoritativeWord, type PdfEmbeddedMetadata, type PdfPageHighlight, type PdfSelectionAnchor } from "./PdfAnchoredPageReader";
import { ScholarlyToolsPanel, type ImportedReadingNoteRecord } from "./ScholarlyToolsPanel";
import type { ReadingNoteCandidate } from "../lib/reading-notes-import";
import { TextAnchoredReader, type TextPageHighlight, type TextSelectionAnchor } from "./TextAnchoredReader";

type CitationStyle = CitationStyleId;
type DocumentKind = "PDF" | "TXT" | "MARKDOWN" | "DOCX";
type SourceRecord = { author: string; title: string; place: string; publisher: string; year: string };
type PageMap = { basePdfPageIndex: number; baseBookPage: number; currentPdfPageIndex: number };
type ServerIds = { documentId: string; versionId: string; sourceId: string; pageMapId: string; storageKey?: string; snapshotKey?: string; sourceChecksum?: string };
type StoredDocument = { id: string; title: string; filename: string; kind: DocumentKind; mediaType: string; size: number; source: SourceRecord; pageMap: PageMap; server?: ServerIds };
type SelectionAnchor = PdfSelectionAnchor | TextSelectionAnchor;
type SavedAnnotation = { id: string; documentId: string; versionId?: string; snapshotKey?: string; colorKey: string; selectedText: string; note: string; pdfPageIndex: number; bookPageLabel: string; citationStyle: CitationStyle; citationText: string; anchor?: SelectionAnchor; createdAt: string; serverAnnotationId?: string; serverCitationId?: string };

type TextPersistResponse = {
  document: { id: string; storageKey?: string | null };
  version: { id: string; sourceChecksum?: string | null; snapshotKey?: string | null };
  source: { id: string };
  pageMap: { id: string };
  textSpan: { text: string };
  storedSnapshot?: { storageKey: string; checksum: string };
};

type SourceUpdateResponse = {
  source: {
    id: string;
    shortTitle?: string | null;
    cslJson?: unknown;
  };
};

const DB_NAME = "scriptorium-file-store";
const DB_VERSION = 1;
const PDF_STORE = "pdf-blobs";
const DOCUMENT_KEY = "scriptorium.currentDocument";
const TEXT_CONTENT_KEY = "scriptorium.currentTextContent";
const ANNOTATIONS_KEY = "scriptorium.annotations";
const INSPECTOR_PIN_KEY = "scriptorium.ui.inspectorPinned";
const PENDING_SPLIT_OCR_KEY = "scriptorium.pendingSplitOcr";
const EMPTY_SOURCE: SourceRecord = { author: "", title: "", place: "", publisher: "", year: "" };
const DEFAULT_PAGE_MAP: PageMap = { basePdfPageIndex: 1, baseBookPage: 1, currentPdfPageIndex: 1 };
const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function localId(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
function bookPage(pageMap: PageMap) { return String(pageMap.baseBookPage + pageMap.currentPdfPageIndex - pageMap.basePdfPageIndex); }
function bytes(size: number) { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }
function serverPdfUrl(document: StoredDocument) { return document.server?.storageKey ? `/api/milestone-one/files/${document.server.documentId}` : null; }
function isPdf(document: StoredDocument | null) { return document?.kind === "PDF"; }
function isText(document: StoredDocument | null): document is StoredDocument & { kind: "TXT" | "MARKDOWN" | "DOCX" } { return document?.kind === "TXT" || document?.kind === "MARKDOWN" || document?.kind === "DOCX"; }
function isTextAnchor(anchor: SelectionAnchor | undefined): anchor is TextSelectionAnchor { return typeof anchor === "object" && anchor !== null && "startOffset" in anchor && "lineStart" in anchor; }
function lineLocator(anchor: TextSelectionAnchor) { return anchor.lineStart === anchor.lineEnd ? String(anchor.lineStart) : `${anchor.lineStart}-${anchor.lineEnd}`; }
function normalizeTextSnapshot(text: string) { return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"); }
function mediaTypeFor(kind: DocumentKind, file: File) { return file.type || (kind === "PDF" ? "application/pdf" : kind === "MARKDOWN" ? "text/markdown" : kind === "DOCX" ? DOCX_MEDIA_TYPE : "text/plain"); }
function formatFor(kind: DocumentKind) { return kind === "MARKDOWN" ? "Markdown" : kind === "TXT" ? "TXT" : kind === "DOCX" ? "DOCX" : "PDF"; }
function titleFromFilename(fileName: string) { return fileName.replace(/\.(pdf|txt|md|markdown|docx)$/i, ""); }

function fileKind(file: File): DocumentKind | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (file.type === "text/markdown" || name.endsWith(".md") || name.endsWith(".markdown")) return "MARKDOWN";
  if (file.type === "text/plain" || name.endsWith(".txt")) return "TXT";
  if (file.type === DOCX_MEDIA_TYPE || name.endsWith(".docx")) return "DOCX";
  return null;
}

function citation(document: StoredDocument, locator: string, style: CitationStyle) {
  const source = document.source;
  const numericYear = Number(source.year);
  const item: CslItem = {
    type: "book",
    title: source.title.trim() || document.title,
    author: source.author.trim() ? [{ literal: source.author.trim() }] : undefined,
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

function normalizeDocument(value: unknown) {
  const parsed = value as Partial<StoredDocument> | null;
  if (!parsed?.id || !parsed.title || !parsed.filename || !parsed.mediaType || !parsed.source || !parsed.pageMap) return null;
  return { ...parsed, kind: parsed.kind ?? "PDF" } as StoredDocument;
}

function validateSource(source: SourceRecord) {
  if (!source.title.trim()) return "A source title is required before saving CSL metadata.";
  if (source.year.trim() && !/^\d{1,4}$/.test(source.year.trim())) return "Year must be a 1-4 digit year.";
  return null;
}

function readDocument() { const raw = localStorage.getItem(DOCUMENT_KEY); return raw ? normalizeDocument(JSON.parse(raw)) : null; }
function readAnnotations() { const raw = localStorage.getItem(ANNOTATIONS_KEY); return raw ? (JSON.parse(raw) as SavedAnnotation[]) : []; }
function saveDocument(document: StoredDocument) { localStorage.setItem(DOCUMENT_KEY, JSON.stringify(document)); }
function saveTextContent(text: string) { localStorage.setItem(TEXT_CONTENT_KEY, text); }
function readTextContent() { return localStorage.getItem(TEXT_CONTENT_KEY) ?? ""; }
function saveAnnotations(records: SavedAnnotation[]) { localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(records)); }

function currentLocator(document: StoredDocument | null, anchor: SelectionAnchor | undefined) {
  if (!document) return "-";
  if (isText(document) && isTextAnchor(anchor)) return lineLocator(anchor);
  if (isText(document)) return "1";
  return bookPage(document.pageMap);
}

function locatorTypeFor(document: StoredDocument, anchor: SelectionAnchor | undefined) { return isText(document) && isTextAnchor(anchor) ? "line" : "page"; }
function recordMatchesCurrentVersion(record: SavedAnnotation, document: StoredDocument | null) { const currentVersionId = document?.server?.versionId; return currentVersionId ? record.versionId ? record.versionId === currentVersionId : true : true; }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(PDF_STORE)) request.result.createObjectStore(PDF_STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putPdf(documentId: string, file: File) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE, "readwrite");
    transaction.objectStore(PDF_STORE).put(file, documentId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getPdf(documentId: string) {
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

async function persistDocument(document: StoredDocument, locator: string) {
  const response = await fetch("/api/milestone-one/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: document.title, filename: document.filename, mediaType: document.mediaType, size: document.size, source: document.source, pageMap: { ...document.pageMap, bookPageLabel: locator } })
  });
  if (!response.ok) throw new Error("Document persistence failed.");
  const body = await response.json() as { document: { id: string }; version: { id: string }; source: { id: string }; pageMap: { id: string } };
  return { documentId: body.document.id, versionId: body.version.id, sourceId: body.source.id, pageMapId: body.pageMap.id } satisfies ServerIds;
}

async function persistPdfFile(file: File, document: StoredDocument, locator: string) {
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
  const response = await fetch("/api/milestone-one/files", { method: "POST", body: formData });
  if (!response.ok) throw new Error("PDF upload persistence failed.");
  const body = await response.json() as { document: { id: string; storageKey?: string | null }; version: { id: string }; source: { id: string }; pageMap: { id: string }; storedFile?: { storageKey: string } };
  return { documentId: body.document.id, versionId: body.version.id, sourceId: body.source.id, pageMapId: body.pageMap.id, storageKey: body.storedFile?.storageKey ?? body.document.storageKey ?? undefined } satisfies ServerIds;
}

async function persistTextLikeFile(file: File, document: StoredDocument, locator: string, existingServerDocumentId?: string) {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("title", document.title);
  formData.set("author", document.source.author);
  formData.set("place", document.source.place);
  formData.set("publisher", document.source.publisher);
  formData.set("year", document.source.year);
  formData.set("bookPageLabel", locator);
  if (existingServerDocumentId) formData.set("documentId", existingServerDocumentId);
  const endpoint = document.kind === "DOCX" ? "/api/milestone-five/docx" : "/api/milestone-three/texts";
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

async function persistSourceMetadata(document: StoredDocument) {
  if (!document.server?.sourceId) throw new Error("Document has no persisted source id.");
  const response = await fetch("/api/milestone-six/sources", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceId: document.server.sourceId, ...document.source })
  });
  if (!response.ok) throw new Error("Source metadata persistence failed.");
  return await response.json() as SourceUpdateResponse;
}

async function persistAnnotation(document: StoredDocument, record: SavedAnnotation) {
  if (!document.server) throw new Error("Document has no server ids.");
  const response = await fetch("/api/milestone-one/annotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId: document.server.documentId, versionId: document.server.versionId, sourceId: document.server.sourceId, pageMapId: document.server.pageMapId, colorKey: record.colorKey, selectedText: record.selectedText, note: record.note, tags: [], anchor: record.anchor, citationStyle: record.citationStyle, citationText: record.citationText, locatorType: locatorTypeFor(document, record.anchor), locatorValue: record.bookPageLabel })
  });
  if (!response.ok) throw new Error("Annotation persistence failed.");
  return await response.json() as { annotation: { id: string }; citation: { id: string } };
}

export function ScriptoriumMilestoneOnePersisted() {
  const [documentRecord, setDocumentRecord] = useState<StoredDocument | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [annotations, setAnnotations] = useState<SavedAnnotation[]>([]);
  const [selectedColor, setSelectedColor] = useState(highlightColors[0].key);
  const [selectedText, setSelectedText] = useState("");
  const [anchor, setAnchor] = useState<SelectionAnchor | undefined>();
  const [note, setNote] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [inspectorPinned, setInspectorPinned] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [pendingSplitOcr, setPendingSplitOcr] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState("all");
  const [compactLayout, setCompactLayout] = useState(false);

  useEffect(() => {
    const savedPin = localStorage.getItem(INSPECTOR_PIN_KEY);
    const compactQuery = window.matchMedia("(max-width: 1279px)");
    const wide = !compactQuery.matches;
    setInspectorPinned(savedPin === null ? wide : savedPin === "true");
    setInspectorOpen(wide);
    setCompactLayout(compactQuery.matches);
    setPendingSplitOcr(Boolean(localStorage.getItem(PENDING_SPLIT_OCR_KEY)));
    const handleLayoutChange = (event: MediaQueryListEvent) => setCompactLayout(event.matches);
    compactQuery.addEventListener("change", handleLayoutChange);
    return () => compactQuery.removeEventListener("change", handleLayoutChange);
  }, []);

  useEffect(() => {
    localStorage.setItem(INSPECTOR_PIN_KEY, String(inspectorPinned));
  }, [inspectorPinned]);

  useEffect(() => {
    function closeOverlay(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (toolsOpen) {
        setToolsOpen(false);
        setPendingSplitOcr(Boolean(localStorage.getItem(PENDING_SPLIT_OCR_KEY)));
      }
      else if (ledgerOpen) setLedgerOpen(false);
      else if (!inspectorPinned || compactLayout) setInspectorOpen(false);
    }
    window.addEventListener("keydown", closeOverlay);
    return () => window.removeEventListener("keydown", closeOverlay);
  }, [compactLayout, inspectorPinned, ledgerOpen, toolsOpen]);

  // A "select some text" workflow needs an equally easy way to back out of
  // it - clears both the app's own captured selection state and the
  // browser's own visible native-highlight selection (window.getSelection
  // is a real, separate thing from selectedText/anchor here - clearing
  // one doesn't clear the other on its own).
  function clearSelection() {
    window.getSelection()?.removeAllRanges();
    setSelectedText("");
    setAnchor(undefined);
  }
  // field-sizing: content (CSS-only auto-grow) turned out to be unreliable
  // across Chrome versions still in real use - stabilized late enough that
  // it can't be counted on yet. This does the same job with plain JS,
  // which works everywhere: measure the content's real height and set the
  // textarea to match, capped by the CSS max-height (overflow-y: auto
  // handles anything beyond that). Runs on every value change, not just
  // onChange, because selectedText is set programmatically by
  // capturePdfAnchor/captureTextAnchor - a real selection on the page, not
  // the person typing - and onChange alone would never fire for that.
  const selectedTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const noteTextAreaRef = useRef<HTMLTextAreaElement | null>(null);

  function autoResize(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    autoResize(selectedTextAreaRef.current);
  }, [selectedText]);

  useEffect(() => {
    autoResize(noteTextAreaRef.current);
  }, [note]);
  const [style, setStyle] = useState<CitationStyle>("sbl-note");
  const [status, setStatus] = useState("Register a PDF, TXT, Markdown, or DOCX file to begin.");
  const [sourceSaveMessage, setSourceSaveMessage] = useState("");
  const [recentAnnotationId, setRecentAnnotationId] = useState<string | undefined>();
  const [authoritativePageText, setAuthoritativePageText] = useState<string | null>(null);
  const [authoritativeWords, setAuthoritativeWords] = useState<PdfAuthoritativeWord[] | null>(null);

  useEffect(() => {
    const storedDocument = readDocument();
    const storedAnnotations = readAnnotations();
    setAnnotations(storedAnnotations);
    if (!storedDocument) return;
    setDocumentRecord(storedDocument);

    if (storedDocument.kind === "PDF") {
      getPdf(storedDocument.id).then((blob) => {
        if (blob) {
          setPdfUrl(URL.createObjectURL(blob));
          setStatus(storedDocument.server?.storageKey ? "Recovered browser PDF and server file record." : storedDocument.server ? "Recovered browser PDF and database ids." : "Recovered browser-local prototype records.");
          return;
        }
        const storedServerUrl = serverPdfUrl(storedDocument);
        if (storedServerUrl) {
          setPdfUrl(storedServerUrl);
          setStatus("Recovered PDF from server file storage.");
          return;
        }
        setStatus("Recovered records, but no browser or server PDF was found.");
      });
      return;
    }

    const localText = readTextContent();
    if (localText) {
      setTextContent(localText);
      setStatus(storedDocument.server?.sourceChecksum ? "Recovered versioned text snapshot and database ids." : storedDocument.server ? "Recovered text document and database ids." : "Recovered browser-local text document.");
      return;
    }

    if (storedDocument.server) {
      fetch(`/api/milestone-one/workspace?documentId=${storedDocument.server.documentId}`)
        .then((response) => response.ok ? response.json() : null)
        .then((body: { document?: { versions?: Array<{ id: string; textSpans?: Array<{ text: string }> }> } } | null) => {
          const currentVersion = body?.document?.versions?.find((version) => version.id === storedDocument.server?.versionId) ?? body?.document?.versions?.[0];
          const text = currentVersion?.textSpans?.[0]?.text ?? "";
          if (text) {
            saveTextContent(text);
            setTextContent(text);
            setStatus("Recovered text document from versioned database text snapshot.");
          } else {
            setStatus("Recovered text metadata, but no text snapshot was found.");
          }
        });
    }
  }, []);

  useEffect(() => () => { if (pdfUrl?.startsWith("blob:")) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const locator = useMemo(() => currentLocator(documentRecord, anchor), [documentRecord, anchor]);
  const generatedCitation = useMemo(() => documentRecord ? citation(documentRecord, locator, style) : "Register a document before generating a citation.", [documentRecord, locator, style]);
  const currentSnapshotRecords = useMemo(() => annotations.filter((record) => recordMatchesCurrentVersion(record, documentRecord)), [annotations, documentRecord]);
  const recentSavedRecord = useMemo(() => recentAnnotationId ? annotations.find((record) => record.id === recentAnnotationId) : undefined, [annotations, recentAnnotationId]);
  const recentSavedColor = recentSavedRecord ? highlightColors.find((item) => item.key === recentSavedRecord.colorKey) ?? highlightColors[0] : undefined;
  const visiblePdfHighlights = useMemo<PdfPageHighlight[]>(() => currentSnapshotRecords.flatMap((record) => {
    if (!record.anchor || isTextAnchor(record.anchor)) return [];
    const color = highlightColors.find((item) => item.key === record.colorKey) ?? highlightColors[0];
    return [{ id: record.id, color: color.color, anchor: record.anchor }];
  }), [currentSnapshotRecords]);
  const previewPdfHighlight = useMemo<PdfPageHighlight[]>(() => {
    if (!documentRecord || documentRecord.kind !== "PDF" || !anchor || isTextAnchor(anchor) || !selectedText.trim()) return [];
    const color = highlightColors.find((item) => item.key === selectedColor) ?? highlightColors[0];
    return [{ id: "active-selection-preview", color: color.color, anchor }];
  }, [anchor, documentRecord, selectedColor, selectedText]);
  const activePdfHighlights = useMemo(() => [...visiblePdfHighlights, ...previewPdfHighlight], [previewPdfHighlight, visiblePdfHighlights]);
  const visibleTextHighlights = useMemo<TextPageHighlight[]>(() => currentSnapshotRecords.flatMap((record) => {
    if (!record.anchor || !isTextAnchor(record.anchor)) return [];
    const color = highlightColors.find((item) => item.key === record.colorKey) ?? highlightColors[0];
    return [{ id: record.id, color: color.color, anchor: record.anchor }];
  }), [currentSnapshotRecords]);

  const mergePdfMetadata = useCallback((metadata: PdfEmbeddedMetadata) => {
    setDocumentRecord((current) => {
      if (!current || current.kind !== "PDF") return current;
      const fileTitle = titleFromFilename(current.filename);
      const nextSource = {
        ...current.source,
        title: metadata.title && (!current.source.title.trim() || current.source.title === fileTitle) ? metadata.title : current.source.title,
        author: metadata.author && !current.source.author.trim() ? metadata.author : current.source.author
      };
      const nextTitle = nextSource.title || current.title;
      const nextDocument = { ...current, title: nextTitle, source: nextSource };
      saveDocument(nextDocument);
      return nextDocument;
    });
  }, []);

  const capturePdfAnchor = useCallback((nextAnchor: PdfSelectionAnchor) => {
    setAnchor(nextAnchor);
    setSelectedText(nextAnchor.selectedText);
    setInspectorOpen(true);
    setStatus("Captured selected text, context, and highlight rectangles from the PDF page. Preview highlight is shown until saved.");
  }, []);

  const captureTextAnchor = useCallback((nextAnchor: TextSelectionAnchor) => {
    setAnchor(nextAnchor);
    setSelectedText(nextAnchor.selectedText);
    setInspectorOpen(true);
    setStatus(`Captured selected text, context, offsets, and line locator ${lineLocator(nextAnchor)}.`);
  }, []);

  async function registerSource(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const kind = fileKind(file);
    if (!kind) {
      setStatus("This workspace accepts PDF, TXT, Markdown, and DOCX files only.");
      return;
    }

    if (pdfUrl?.startsWith("blob:")) URL.revokeObjectURL(pdfUrl);

    const textReimportDocument = kind !== "PDF" && isText(documentRecord) && documentRecord.kind === kind && documentRecord.server?.documentId ? documentRecord : null;
    const isTextReimport = Boolean(textReimportDocument);
    const documentId = textReimportDocument ? textReimportDocument.id : localId("doc");
    const title = titleFromFilename(file.name);
    let nextDocument: StoredDocument = textReimportDocument
      ? { ...textReimportDocument, title, filename: file.name, mediaType: mediaTypeFor(kind, file), size: file.size, source: { ...textReimportDocument.source, title: textReimportDocument.source.title || title }, pageMap: DEFAULT_PAGE_MAP }
      : { id: documentId, title, filename: file.name, kind, mediaType: mediaTypeFor(kind, file), size: file.size, source: { ...EMPTY_SOURCE, title }, pageMap: DEFAULT_PAGE_MAP };

    if (!isTextReimport) {
      saveAnnotations([]);
      setAnnotations([]);
    }
    setSelectedText("");
    setAnchor(undefined);
    setNote("");
    setPageCount(0);
    setSourceSaveMessage("");
    setRecentAnnotationId(undefined);

    if (kind === "PDF") {
      setTextContent("");
      saveTextContent("");
      await putPdf(documentId, file);
      try {
        const server = await persistPdfFile(file, nextDocument, bookPage(nextDocument.pageMap));
        nextDocument = { ...nextDocument, server };
        setStatus("PDF registered, uploaded, and database metadata persisted. Embedded metadata will prefill fields if available.");
      } catch {
        try {
          const server = await persistDocument(nextDocument, bookPage(nextDocument.pageMap));
          nextDocument = { ...nextDocument, server };
          setStatus("PDF registered locally and document metadata persisted. Server file storage is unavailable.");
        } catch {
          setStatus("PDF registered locally. Database persistence is unavailable in this environment.");
        }
      }
      setPdfUrl(URL.createObjectURL(file));
    } else {
      setPdfUrl(null);
      if (kind === "DOCX") {
        setTextContent("");
        saveTextContent("");
      } else {
        const normalizedText = normalizeTextSnapshot(await file.text());
        setTextContent(normalizedText);
        saveTextContent(normalizedText);
      }
      try {
        const persisted = await persistTextLikeFile(file, nextDocument, "1", textReimportDocument?.server?.documentId);
        nextDocument = { ...nextDocument, server: persisted.server };
        setTextContent(persisted.text);
        saveTextContent(persisted.text);
        setStatus(`${formatFor(kind)} ${isTextReimport ? "reimported as a new version" : "document registered"}; checksum ${persisted.server.sourceChecksum?.slice(0, 12) ?? "pending"}; annotations remain version-specific.`);
      } catch {
        setStatus(`${formatFor(kind)} document registration failed. ${kind === "DOCX" ? "DOCX extraction requires the server route." : "Database snapshot persistence is unavailable in this environment."}`);
      }
    }

    saveDocument(nextDocument);
    setDocumentRecord(nextDocument);
  }

  function updateDocument(nextDocument: StoredDocument) { setDocumentRecord(nextDocument); saveDocument(nextDocument); }
  function updateSource(field: keyof SourceRecord, value: string) {
    if (!documentRecord) return;
    setSourceSaveMessage("Unsaved source metadata changes.");
    updateDocument({ ...documentRecord, title: field === "title" ? value : documentRecord.title, source: { ...documentRecord.source, [field]: value } });
  }
  function updatePageMap(field: keyof PageMap, value: number) { if (documentRecord) updateDocument({ ...documentRecord, pageMap: { ...documentRecord.pageMap, [field]: Number.isFinite(value) ? value : 1 } }); }
  function goToPage(page: number) { if (!documentRecord || documentRecord.kind !== "PDF") return; const upper = pageCount > 0 ? pageCount : page; setAnchor(undefined); setSelectedText(""); updatePageMap("currentPdfPageIndex", Math.min(Math.max(page, 1), upper)); }

  async function saveSourceRecord() {
    if (!documentRecord) { setStatus("Register a document before saving CSL source metadata."); return; }
    const validationMessage = validateSource(documentRecord.source);
    if (validationMessage) { setStatus(validationMessage); setSourceSaveMessage(validationMessage); return; }
    const nextDocument = { ...documentRecord, title: documentRecord.source.title.trim() || documentRecord.title, source: { ...documentRecord.source, title: documentRecord.source.title.trim(), author: documentRecord.source.author.trim(), place: documentRecord.source.place.trim(), publisher: documentRecord.source.publisher.trim(), year: documentRecord.source.year.trim() } };

    setSourceSaveMessage("Saving CSL source metadata…");
    try {
      await persistSourceMetadata(nextDocument);
      updateDocument(nextDocument);
      setSourceSaveMessage("CSL source metadata saved to database.");
      setStatus("Saved CSL-compatible source metadata to the database.");
    } catch {
      updateDocument(nextDocument);
      setSourceSaveMessage("Source metadata saved locally; database source persistence is unavailable for this record.");
      setStatus("Saved source metadata locally. Database source persistence is unavailable for this record.");
    }
  }

  async function saveRecord() {
    if (!documentRecord) { setStatus("Register a document before saving an annotation."); return; }
    const normalizedSelectedText = selectedText.trim();
    const normalizedNote = note.trim();
    if (!normalizedSelectedText && !normalizedNote) { setStatus("Capture a passage or enter a page note before saving."); return; }
    if (isText(documentRecord) && !isTextAnchor(anchor)) { setStatus("Select text directly in the text reader so the annotation has a stable line/offset anchor."); return; }

    const normalizedAnchor = anchor ? { ...anchor, selectedText: normalizedSelectedText } as SelectionAnchor : undefined;
    let record: SavedAnnotation = { id: localId("ann"), documentId: documentRecord.id, versionId: documentRecord.server?.versionId, snapshotKey: documentRecord.server?.snapshotKey, colorKey: selectedColor, selectedText: normalizedSelectedText, note: normalizedNote, pdfPageIndex: documentRecord.pageMap.currentPdfPageIndex, bookPageLabel: currentLocator(documentRecord, normalizedAnchor), citationStyle: style, citationText: citation(documentRecord, currentLocator(documentRecord, normalizedAnchor), style), anchor: normalizedAnchor, createdAt: new Date().toISOString() };

    try {
      const serverRecord = await persistAnnotation(documentRecord, record);
      record = { ...record, serverAnnotationId: serverRecord.annotation.id, serverCitationId: serverRecord.citation.id };
      setStatus("Saved annotation locally and in the database. The latest saved record is shown in the annotation panel.");
    } catch {
      setStatus("Saved annotation locally. The latest saved record is shown in the annotation panel; database persistence is unavailable for this record.");
    }

    setAnnotations((previous) => {
      const next = [record, ...previous];
      saveAnnotations(next);
      return next;
    });
    setRecentAnnotationId(record.id);
    setSelectedText("");
    setAnchor(undefined);
    setNote("");
  }

  function clearRecords() { localStorage.setItem(ANNOTATIONS_KEY, "[]"); setAnnotations([]); setSelectedText(""); setAnchor(undefined); setNote(""); setRecentAnnotationId(undefined); setStatus("Cleared annotation records for the current browser workspace."); }

  function previewReadingNote(candidate: ReadingNoteCandidate) {
    if (!documentRecord || documentRecord.kind !== "PDF" || !candidate.anchor) return;
    goToPage(candidate.anchor.pageNumber);
    setAnchor(candidate.anchor);
    setSelectedText(candidate.selectedText);
    setNote(candidate.note);
    setToolsOpen(false);
    setInspectorOpen(true);
    setStatus(`Previewing the proposed highlight for book page ${candidate.pageLabel}. Review it in the inspector before importing.`);
  }

  function addImportedReadingNotes(records: ImportedReadingNoteRecord[]) {
    if (!documentRecord) return;
    const imported: SavedAnnotation[] = records.map((record) => ({
      id: `import_${record.annotationId}`,
      documentId: documentRecord.id,
      versionId: documentRecord.server?.versionId,
      snapshotKey: documentRecord.server?.snapshotKey,
      colorKey: record.colorKey,
      selectedText: record.selectedText,
      note: record.note,
      pdfPageIndex: record.pdfPageIndex,
      bookPageLabel: record.bookPageLabel,
      citationStyle: record.citationStyle as CitationStyle,
      citationText: record.citationText,
      anchor: record.anchor,
      createdAt: record.createdAt,
      serverAnnotationId: record.annotationId,
      serverCitationId: record.citationId
    }));
    setAnnotations((previous) => {
      const known = new Set(previous.map((record) => record.serverAnnotationId).filter(Boolean));
      const next = [...imported.filter((record) => !known.has(record.serverAnnotationId)), ...previous];
      saveAnnotations(next);
      return next;
    });
    setLedgerOpen(true);
    setStatus(`Imported ${imported.length} earlier reading note${imported.length === 1 ? "" : "s"} as native Ledger records.`);
  }

  const currentPage = documentRecord?.pageMap.currentPdfPageIndex ?? 1;
  const formatLabel = documentRecord ? formatFor(documentRecord.kind) : "PDF";

  useEffect(() => {
    const versionId = documentRecord?.server?.versionId;
    if (!versionId || documentRecord?.kind !== "PDF") {
      setAuthoritativePageText(null);
      setAuthoritativeWords(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/milestone-sixteen/page-text?versionId=${encodeURIComponent(versionId)}&pdfPageIndex=${currentPage}`)
      .then((response) => (response.ok ? response.json() : { text: null, words: null }))
      .then((body: { text?: string | null; words?: PdfAuthoritativeWord[] | null }) => {
        if (cancelled) return;
        setAuthoritativePageText(body.text ?? null);
        setAuthoritativeWords(body.words ?? null);
      })
      .catch(() => {
        // Best-effort only - most documents won't have extraction/OCR data
        // yet, and that's a normal, silent case, not an error to surface.
        if (!cancelled) {
          setAuthoritativePageText(null);
          setAuthoritativeWords(null);
        }
      });
    return () => { cancelled = true; };
  }, [documentRecord?.server?.versionId, documentRecord?.kind, currentPage]);

  const usedHighlightColors = highlightColors.filter((color) => annotations.some((record) => record.colorKey === color.key));
  const filteredAnnotations = annotations.filter((record) => {
    if (ledgerFilter === "all") return true;
    if (ledgerFilter === "prior") return !recordMatchesCurrentVersion(record, documentRecord);
    return record.colorKey === ledgerFilter;
  });

  function toggleInspectorPin() {
    setInspectorPinned((pinned) => {
      const next = !pinned;
      if (next) setInspectorOpen(true);
      return next;
    });
  }

  function openAnnotationInspector() {
    setInspectorOpen(true);
    window.requestAnimationFrame(() => {
      const field = selectedTextAreaRef.current;
      if (!field || field.disabled) return;
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      field.focus({ preventScroll: true });
      setStatus(selectedText.trim()
        ? "Annotation inspector focused. Review the selected passage, add your note, and save."
        : "Annotation inspector focused. Select a passage in the document or enter one here.");
    });
  }

  function openCurrentRecord(record: SavedAnnotation) {
    if (!recordMatchesCurrentVersion(record, documentRecord) || !record.anchor || isTextAnchor(record.anchor)) return;
    goToPage(record.anchor.pageNumber);
    setLedgerOpen(false);
    setStatus(`Opened saved highlight on PDF page ${record.anchor.pageNumber}.`);
  }

  return (
    <section className={`ledgerWorkspace${inspectorPinned ? " inspectorPinned" : ""}${inspectorOpen ? " inspectorOpen" : ""}`} aria-label="Scriptorium scholarly reading workspace">
      <a className="skipLink" href="#ledger-reader">Skip to document</a>
      <header className="ledgerTopbar">
        <div className="ledgerBrand">
          <strong>Scriptorium</strong>
          <span aria-hidden="true">/</span>
          <span className="activeDocumentTitle">{documentRecord?.title ?? "No source registered"}</span>
          <span className="locatorChip">{isText(documentRecord) ? `Line ${locator}` : documentRecord ? `Book p. ${locator}` : "No locator"}</span>
        </div>
        <div className="ledgerActions">
          <button className="compactAction ledgerToggle" type="button" onClick={() => setLedgerOpen(true)}>Records · {annotations.length}</button>
          <button className="compactAction toolsToggle" type="button" onClick={() => setToolsOpen(true)}>Scholarly tools{pendingSplitOcr ? " · attention" : ""}</button>
          <button className="compactAction pinToggle" type="button" aria-pressed={inspectorPinned} onClick={toggleInspectorPin}>{inspectorPinned ? "Unpin inspector" : "Pin inspector"}</button>
          <button
            className="compactAction inspectorToggle"
            type="button"
            aria-controls="annotation-inspector"
            aria-expanded={inspectorPinned || inspectorOpen}
            title={inspectorPinned ? "Focus annotation form" : "Open annotation form"}
            onClick={openAnnotationInspector}
          >
            Annotate
          </button>
          <label className="uploadButton">Register source<input type="file" accept="application/pdf,.pdf,text/plain,.txt,text/markdown,.md,.markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={registerSource} /></label>
        </div>
      </header>

      {pendingSplitOcr ? (
        <div className="ledgerAttention" role="status">
          <span><strong>OCR required for the new split document.</strong> Open Scholarly tools to make its pages selectable, searchable, and exportable.</span>
          <button type="button" onClick={() => setToolsOpen(true)}>Open OCR tools</button>
        </div>
      ) : null}

      <div className="ledgerBody">
        <aside className={`ledgerPane${ledgerOpen ? " open" : ""}`} aria-label="Saved scholarly records">
          <div className="paneHeader">
            <div><p className="eyebrow">Research memory</p><h2>Ledger</h2></div>
            <button className="paneClose" type="button" onClick={() => setLedgerOpen(false)} aria-label="Close saved records">×</button>
          </div>
          <p className="paneCount">{annotations.length} saved · {currentSnapshotRecords.length} current snapshot</p>
          <div className="ledgerFilters" aria-label="Filter saved records">
            <button type="button" className={ledgerFilter === "all" ? "active" : ""} onClick={() => setLedgerFilter("all")}>All</button>
            {usedHighlightColors.map((color) => <button type="button" title={color.defaultMeaning} aria-label={`Filter by ${color.defaultMeaning}`} className={ledgerFilter === color.key ? "active" : ""} onClick={() => setLedgerFilter(color.key)} key={color.key}><span style={{ background: color.color }} /></button>)}
            {annotations.some((record) => !recordMatchesCurrentVersion(record, documentRecord)) ? <button type="button" className={ledgerFilter === "prior" ? "active" : ""} onClick={() => setLedgerFilter("prior")}>Prior</button> : null}
          </div>
          <div className="ledgerRecords">
            {filteredAnnotations.length === 0 ? <p className="emptyAnnotationState">No annotations in this view yet.</p> : filteredAnnotations.map((record) => {
              const color = highlightColors.find((item) => item.key === record.colorKey) ?? highlightColors[0];
              const current = recordMatchesCurrentVersion(record, documentRecord);
              const canOpen = current && record.anchor && !isTextAnchor(record.anchor);
              return <article className="ledgerRecord" key={record.id}>
                <div className="recordHeader"><span className="recordColor" style={{ background: color.color }} /><strong>{color.defaultMeaning}</strong><span>{isText(documentRecord) ? "line" : "book p."} {record.bookPageLabel}</span></div>
                {record.selectedText ? <blockquote>{record.selectedText}</blockquote> : null}
                {record.note ? <p>{record.note}</p> : null}
                <div className="recordCitation">{record.citationText}</div>
                <small>{current ? "Current snapshot" : "Prior snapshot"} · {record.serverAnnotationId ? "database" : "local"}</small>
                {canOpen ? <button className="recordOpen" type="button" onClick={() => openCurrentRecord(record)}>Go to highlight</button> : null}
              </article>;
            })}
          </div>
          <div className="ledgerFooter">
            {documentRecord ? <div className="documentSummary"><strong>{documentRecord.title}</strong><span>{formatLabel} · {documentRecord.filename} · {bytes(documentRecord.size)} {documentRecord.server?.sourceChecksum ? `· checksum ${documentRecord.server.sourceChecksum.slice(0, 12)}` : documentRecord.server?.storageKey ? "· server file" : documentRecord.server ? "· database-linked" : "· local only"}</span></div> : null}
            <button className="clearBrowserRecords" onClick={clearRecords} type="button" disabled={annotations.length === 0}>Clear browser annotation list</button>
          </div>
        </aside>

        <main className="ledgerReader" id="ledger-reader" tabIndex={-1}>
          <section className="pdfPanel" aria-label="Document display">
            {isPdf(documentRecord) ? (
              pdfUrl ? <PdfAnchoredPageReader fileUrl={pdfUrl} pageNumber={currentPage} pageCount={pageCount} onPageChange={goToPage} highlights={activePdfHighlights} onPageCountChange={setPageCount} onSelectionCapture={capturePdfAnchor} onStatusChange={setStatus} onMetadataExtracted={mergePdfMetadata} authoritativePageText={authoritativePageText} authoritativeWords={authoritativeWords} hasSelection={Boolean(selectedText || anchor)} onClearSelection={clearSelection} /> : <div className="emptyPdfState"><strong>No PDF available.</strong><span>Register a PDF or recover its server file.</span></div>
            ) : isText(documentRecord) ? (
              textContent ? <TextAnchoredReader text={textContent} highlights={visibleTextHighlights} onSelectionCapture={captureTextAnchor} onStatusChange={setStatus} /> : <div className="emptyPdfState"><strong>No text snapshot available.</strong><span>Register a TXT, Markdown, or DOCX file.</span></div>
            ) : <div className="emptyPdfState"><strong>No source registered yet.</strong><span>Use Register source to load PDF, TXT, Markdown, or DOCX.</span></div>}
          </section>
        </main>

        <aside id="annotation-inspector" className="inspectorPane" aria-label="Annotation inspector" aria-hidden={(!inspectorPinned || compactLayout) && !inspectorOpen}>
          <div className="paneHeader">
            <div><p className="eyebrow">Current selection</p><h2>New record</h2></div>
            <button className="paneClose inspectorClose" type="button" onClick={() => setInspectorOpen(false)} aria-label="Close annotation inspector">×</button>
          </div>
          <div className="captureCard">
            <label>Selected passage<textarea ref={selectedTextAreaRef} className="autoGrowTextarea" value={selectedText} onChange={(event) => setSelectedText(event.target.value)} onInput={(event) => autoResize(event.currentTarget)} placeholder="Selected text appears here." rows={5} disabled={!documentRecord} /></label>
            {(selectedText || anchor) ? <button className="textAction" type="button" onClick={clearSelection}>Clear selection</button> : null}
            <label>Note<textarea ref={noteTextAreaRef} className="autoGrowTextarea" value={note} onChange={(event) => setNote(event.target.value)} onInput={(event) => autoResize(event.currentTarget)} placeholder="Add your note." rows={5} disabled={!documentRecord} /></label>
            <fieldset className="colorPicker"><legend>Highlight meaning</legend><div>{highlightColors.map((color) => <button className={selectedColor === color.key ? "active" : ""} aria-label={`${color.defaultMeaning}${selectedColor === color.key ? ", selected" : ""}`} title={color.defaultMeaning} key={color.key} onClick={() => setSelectedColor(color.key)} type="button"><span style={{ background: color.color }} /></button>)}</div><strong>{highlightColors.find((color) => color.key === selectedColor)?.defaultMeaning}</strong></fieldset>
            <label>Citation style<select value={style} onChange={(event) => setStyle(event.target.value as CitationStyle)}><option value="sbl-note">SBL / Chicago / Turabian note</option><option value="apa">APA</option><option value="mla">MLA</option><option value="harvard">Harvard</option></select></label>
            <div className="generatedCitation"><span>Generated citation</span><p>{generatedCitation}</p></div>
            {anchor ? <p className="anchorSummary">Anchor captured: {isTextAnchor(anchor) ? `line ${lineLocator(anchor)}, offsets ${anchor.startOffset}-${anchor.endOffset}` : `${anchor.rects.length} rectangle${anchor.rects.length === 1 ? "" : "s"} on PDF page ${anchor.pageNumber}`}.</p> : null}
            <button className="primaryButton saveRecordButton" onClick={saveRecord} type="button">{selectedText.trim() ? "Save annotation + citation" : "Save page note + citation"}</button>
          </div>
          {recentSavedRecord && recentSavedColor ? <div className="recentSavedRecord"><div><span className="recordColor" style={{ background: recentSavedColor.color }} /><strong>Latest saved record</strong></div>{recentSavedRecord.selectedText ? <blockquote>{recentSavedRecord.selectedText}</blockquote> : null}{recentSavedRecord.note ? <p>{recentSavedRecord.note}</p> : null}<small>{isText(documentRecord) ? "line" : "book page"} {recentSavedRecord.bookPageLabel} · {recentSavedRecord.serverAnnotationId ? "database" : "local"}</small></div> : null}
          <details className="inspectorGroup" open>
            <summary>Source metadata {sourceSaveMessage.startsWith("Unsaved") ? <span className="unsavedDot" aria-label="Unsaved changes" /> : null}</summary>
            <div className="inspectorGroupContent">
              <label>Title<input value={documentRecord?.source.title ?? ""} onChange={(event) => updateSource("title", event.target.value)} disabled={!documentRecord} /></label>
              <label>Author / editor<input value={documentRecord?.source.author ?? ""} onChange={(event) => updateSource("author", event.target.value)} disabled={!documentRecord} /></label>
              <div className="twoColumnInputs"><label>Place<input value={documentRecord?.source.place ?? ""} onChange={(event) => updateSource("place", event.target.value)} disabled={!documentRecord} /></label><label>Year<input value={documentRecord?.source.year ?? ""} onChange={(event) => updateSource("year", event.target.value)} disabled={!documentRecord} /></label></div>
              <label>Publisher<input value={documentRecord?.source.publisher ?? ""} onChange={(event) => updateSource("publisher", event.target.value)} disabled={!documentRecord} /></label>
              <button className="secondaryButton" onClick={saveSourceRecord} type="button" disabled={!documentRecord}>Save CSL source metadata</button>
              {sourceSaveMessage ? <p className="inlineSaveNotice">{sourceSaveMessage}</p> : null}
            </div>
          </details>
          <details className="inspectorGroup" open>
            <summary>{isPdf(documentRecord) ? "Page mapping" : "Text locator"}</summary>
            <div className="inspectorGroupContent">
              {isPdf(documentRecord) ? <>
                <div className="twoColumnInputs"><label>PDF page<input type="number" min="1" max={pageCount || undefined} value={currentPage} onChange={(event) => goToPage(Number(event.target.value))} disabled={!documentRecord} /></label><label>Book page<input value={locator} readOnly /></label></div>
                <div className="mappingFormula"><span>Mapping rule</span><label>PDF page<input type="number" min="1" value={documentRecord?.pageMap.basePdfPageIndex ?? 1} onChange={(event) => updatePageMap("basePdfPageIndex", Number(event.target.value))} disabled={!documentRecord} /></label><label>= book page<input type="number" value={documentRecord?.pageMap.baseBookPage ?? 1} onChange={(event) => updatePageMap("baseBookPage", Number(event.target.value))} disabled={!documentRecord} /></label></div>
              </> : <div className="textLocatorBox"><strong>{locator === "-" ? "No text-like document registered" : `Current locator: line ${locator}`}</strong><span>TXT, Markdown, and DOCX anchors use character offsets plus line numbers. Current snapshot checksum: {documentRecord?.server?.sourceChecksum?.slice(0, 12) ?? "not persisted"}.</span></div>}
            </div>
          </details>
        </aside>
      </div>

      <p className="ledgerStatus" role="status" aria-live="polite">{status}</p>

      <div className={`toolsDrawer${toolsOpen ? " open" : ""}`} aria-hidden={!toolsOpen}>
        <div className="drawerHeader"><div><p className="eyebrow">Research utilities</p><strong>Scholarly tools</strong></div><button type="button" onClick={() => { setToolsOpen(false); setPendingSplitOcr(Boolean(localStorage.getItem(PENDING_SPLIT_OCR_KEY))); }} aria-label="Close scholarly tools">×</button></div>
        <ScholarlyToolsPanel active={toolsOpen} onPreviewReadingNote={previewReadingNote} onReadingNotesImported={addImportedReadingNotes} />
      </div>
      {toolsOpen ? <button className="drawerScrim" type="button" onClick={() => { setToolsOpen(false); setPendingSplitOcr(Boolean(localStorage.getItem(PENDING_SPLIT_OCR_KEY))); }} aria-label="Close scholarly tools" /> : null}
      {ledgerOpen ? <button className="ledgerScrim" type="button" onClick={() => setLedgerOpen(false)} aria-label="Close saved records" /> : null}
      {(!inspectorPinned || compactLayout) && inspectorOpen ? <button className="inspectorScrim" type="button" onClick={() => setInspectorOpen(false)} aria-label="Close annotation inspector" /> : null}
    </section>
  );
}
