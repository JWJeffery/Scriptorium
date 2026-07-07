"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { highlightColors } from "../lib/highlights";
import { PdfAnchoredPageReader, type PdfPageHighlight, type PdfSelectionAnchor } from "./PdfAnchoredPageReader";
import { TextAnchoredReader, type TextPageHighlight, type TextSelectionAnchor } from "./TextAnchoredReader";

type CitationStyle = "sbl-note" | "chicago-note";
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
  const author = source.author.trim() || "Unknown author";
  const title = source.title.trim() || document.title;
  const imprintParts = [source.place.trim(), source.publisher.trim()].filter(Boolean).join(": ");
  const imprint = [imprintParts, source.year.trim()].filter(Boolean).join(", ");
  const publication = imprint ? ` (${imprint})` : "";
  return `${author}, ${title}${publication}, ${locator}.`;
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
  const [style, setStyle] = useState<CitationStyle>("sbl-note");
  const [status, setStatus] = useState("Register a PDF, TXT, Markdown, or DOCX file to begin.");

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
  const visiblePdfHighlights = useMemo<PdfPageHighlight[]>(() => currentSnapshotRecords.flatMap((record) => {
    if (!record.anchor || isTextAnchor(record.anchor)) return [];
    const color = highlightColors.find((item) => item.key === record.colorKey) ?? highlightColors[0];
    return [{ id: record.id, color: color.color, anchor: record.anchor }];
  }), [currentSnapshotRecords]);
  const visibleTextHighlights = useMemo<TextPageHighlight[]>(() => currentSnapshotRecords.flatMap((record) => {
    if (!record.anchor || !isTextAnchor(record.anchor)) return [];
    const color = highlightColors.find((item) => item.key === record.colorKey) ?? highlightColors[0];
    return [{ id: record.id, color: color.color, anchor: record.anchor }];
  }), [currentSnapshotRecords]);

  const capturePdfAnchor = useCallback((nextAnchor: PdfSelectionAnchor) => {
    setAnchor(nextAnchor);
    setSelectedText(nextAnchor.selectedText);
    setStatus("Captured selected text, context, and highlight rectangles from the PDF page.");
  }, []);

  const captureTextAnchor = useCallback((nextAnchor: TextSelectionAnchor) => {
    setAnchor(nextAnchor);
    setSelectedText(nextAnchor.selectedText);
    setStatus(`Captured selected text, context, offsets, and line locator ${lineLocator(nextAnchor)}.`);
  }, []);

  async function registerSource(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const kind = fileKind(file);
    if (!kind) {
      setStatus("This gate accepts PDF, TXT, Markdown, and DOCX files only.");
      return;
    }

    if (pdfUrl?.startsWith("blob:")) URL.revokeObjectURL(pdfUrl);

    const textReimportDocument = kind !== "PDF" && isText(documentRecord) && documentRecord.kind === kind && documentRecord.server?.documentId ? documentRecord : null;
    const isTextReimport = Boolean(textReimportDocument);
    const documentId = textReimportDocument ? textReimportDocument.id : localId("doc");
    const title = file.name.replace(/\.(pdf|txt|md|markdown|docx)$/i, "");
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

    if (kind === "PDF") {
      setTextContent("");
      saveTextContent("");
      await putPdf(documentId, file);
      try {
        const server = await persistPdfFile(file, nextDocument, bookPage(nextDocument.pageMap));
        nextDocument = { ...nextDocument, server };
        setStatus("PDF registered locally, uploaded to server storage, and database metadata persisted.");
      } catch {
        try {
          const server = await persistDocument(nextDocument, bookPage(nextDocument.pageMap));
          nextDocument = { ...nextDocument, server };
          setStatus("PDF registered locally and document metadata persisted to the database. Server file storage is unavailable.");
        } catch {
          setStatus("PDF registered locally. Database persistence is unavailable in this environment.");
        }
      }
      setPdfUrl(URL.createObjectURL(file));
    } else {
      if (pdfUrl?.startsWith("blob:")) URL.revokeObjectURL(pdfUrl);
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
  function updateSource(field: keyof SourceRecord, value: string) { if (documentRecord) updateDocument({ ...documentRecord, title: field === "title" ? value : documentRecord.title, source: { ...documentRecord.source, [field]: value } }); }
  function updatePageMap(field: keyof PageMap, value: number) { if (documentRecord) updateDocument({ ...documentRecord, pageMap: { ...documentRecord.pageMap, [field]: Number.isFinite(value) ? value : 1 } }); }
  function goToPage(page: number) { if (!documentRecord || documentRecord.kind !== "PDF") return; const upper = pageCount > 0 ? pageCount : page; setAnchor(undefined); updatePageMap("currentPdfPageIndex", Math.min(Math.max(page, 1), upper)); }

  async function saveSourceRecord() {
    if (!documentRecord) { setStatus("Register a document before saving CSL source metadata."); return; }
    const validationMessage = validateSource(documentRecord.source);
    if (validationMessage) { setStatus(validationMessage); return; }
    const nextDocument = { ...documentRecord, title: documentRecord.source.title.trim() || documentRecord.title, source: { ...documentRecord.source, title: documentRecord.source.title.trim(), author: documentRecord.source.author.trim(), place: documentRecord.source.place.trim(), publisher: documentRecord.source.publisher.trim(), year: documentRecord.source.year.trim() } };

    try {
      await persistSourceMetadata(nextDocument);
      updateDocument(nextDocument);
      setStatus("Saved CSL-compatible source metadata to the database.");
    } catch {
      updateDocument(nextDocument);
      setStatus("Saved source metadata locally. Database source persistence is unavailable for this record.");
    }
  }

  async function saveRecord() {
    if (!documentRecord) { setStatus("Register a document before saving an annotation."); return; }
    const normalizedSelectedText = selectedText.trim();
    if (!normalizedSelectedText) { setStatus("Capture or enter selected text before saving."); return; }
    if (isText(documentRecord) && !isTextAnchor(anchor)) { setStatus("Select text directly in the text reader so the annotation has a stable line/offset anchor."); return; }

    const normalizedAnchor = anchor ? { ...anchor, selectedText: normalizedSelectedText } as SelectionAnchor : undefined;
    let record: SavedAnnotation = { id: localId("ann"), documentId: documentRecord.id, versionId: documentRecord.server?.versionId, snapshotKey: documentRecord.server?.snapshotKey, colorKey: selectedColor, selectedText: normalizedSelectedText, note: note.trim(), pdfPageIndex: documentRecord.pageMap.currentPdfPageIndex, bookPageLabel: currentLocator(documentRecord, normalizedAnchor), citationStyle: style, citationText: citation(documentRecord, currentLocator(documentRecord, normalizedAnchor), style), anchor: normalizedAnchor, createdAt: new Date().toISOString() };

    try {
      const serverRecord = await persistAnnotation(documentRecord, record);
      record = { ...record, serverAnnotationId: serverRecord.annotation.id, serverCitationId: serverRecord.citation.id };
      setStatus("Saved annotation locally and in the database.");
    } catch {
      setStatus("Saved annotation locally. Database persistence is unavailable for this record.");
    }

    const next = [record, ...annotations];
    setAnnotations(next);
    saveAnnotations(next);
    setSelectedText("");
    setAnchor(undefined);
    setNote("");
  }

  function clearRecords() { localStorage.setItem(ANNOTATIONS_KEY, "[]"); setAnnotations([]); setSelectedText(""); setAnchor(undefined); setNote(""); setStatus("Cleared annotation records for the current browser workspace."); }

  const currentPage = documentRecord?.pageMap.currentPdfPageIndex ?? 1;
  const formatLabel = documentRecord ? formatFor(documentRecord.kind) : "PDF";

  return (
    <section className="workflow" aria-label="Scriptorium scholarly ingestion workflow">
      <div className="workflowHeader">
        <div>
          <p className="eyebrow">Current gate</p>
          <h2>CSL source editor</h2>
          <p>Register PDF, TXT, Markdown, or DOCX sources. The source metadata panel now saves a controlled CSL-compatible source record used by generated citations.</p>
        </div>
        <label className="uploadButton">Register source<input type="file" accept="application/pdf,.pdf,text/plain,.txt,text/markdown,.md,.markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={registerSource} /></label>
      </div>
      <p className="statusLine">{status}</p>
      <div className="milestoneGrid">
        <aside className="panel controlsPanel">
          <h3>CSL source metadata</h3>
          <label>Title<input value={documentRecord?.source.title ?? ""} onChange={(event) => updateSource("title", event.target.value)} disabled={!documentRecord} /></label>
          <label>Author / editor<input value={documentRecord?.source.author ?? ""} onChange={(event) => updateSource("author", event.target.value)} disabled={!documentRecord} /></label>
          <div className="twoColumnInputs"><label>Place<input value={documentRecord?.source.place ?? ""} onChange={(event) => updateSource("place", event.target.value)} disabled={!documentRecord} /></label><label>Year<input value={documentRecord?.source.year ?? ""} onChange={(event) => updateSource("year", event.target.value)} disabled={!documentRecord} /></label></div>
          <label>Publisher<input value={documentRecord?.source.publisher ?? ""} onChange={(event) => updateSource("publisher", event.target.value)} disabled={!documentRecord} /></label>
          <button className="secondaryButton" onClick={saveSourceRecord} type="button" disabled={!documentRecord}>Save CSL source metadata</button>
          <h3>{isPdf(documentRecord) ? "Page map" : "Text locator"}</h3>
          {isPdf(documentRecord) ? (
            <>
              <div className="twoColumnInputs"><label>PDF page<input type="number" min="1" max={pageCount || undefined} value={currentPage} onChange={(event) => goToPage(Number(event.target.value))} disabled={!documentRecord} /></label><label>Book page<input value={locator} readOnly /></label></div>
              <div className="pageStepper"><button type="button" onClick={() => goToPage(currentPage - 1)} disabled={!documentRecord || currentPage <= 1}>Previous</button><span>{pageCount ? `${currentPage} / ${pageCount}` : "No page count yet"}</span><button type="button" onClick={() => goToPage(currentPage + 1)} disabled={!documentRecord || (pageCount > 0 && currentPage >= pageCount)}>Next</button></div>
              <div className="mappingFormula"><span>Mapping rule</span><label>PDF page<input type="number" min="1" value={documentRecord?.pageMap.basePdfPageIndex ?? 1} onChange={(event) => updatePageMap("basePdfPageIndex", Number(event.target.value))} disabled={!documentRecord} /></label><label>= book page<input type="number" value={documentRecord?.pageMap.baseBookPage ?? 1} onChange={(event) => updatePageMap("baseBookPage", Number(event.target.value))} disabled={!documentRecord} /></label></div>
            </>
          ) : (
            <div className="textLocatorBox"><strong>{locator === "-" ? "No text-like document registered" : `Current locator: line ${locator}`}</strong><span>TXT, Markdown, and DOCX anchors use character offsets plus line numbers. Current snapshot checksum: {documentRecord?.server?.sourceChecksum?.slice(0, 12) ?? "not persisted"}.</span></div>
          )}
          <h3>Highlight color</h3>
          <div className="workflowPalette">{highlightColors.map((color) => <button className={selectedColor === color.key ? "workflowSwatch active" : "workflowSwatch"} key={color.key} onClick={() => setSelectedColor(color.key)} type="button"><span style={{ background: color.color }} />{color.defaultMeaning}</button>)}</div>
        </aside>
        <section className="pdfPanel" aria-label="Document display">
          {isPdf(documentRecord) ? (
            pdfUrl ? <PdfAnchoredPageReader fileUrl={pdfUrl} pageNumber={currentPage} highlights={visiblePdfHighlights} onPageCountChange={setPageCount} onSelectionCapture={capturePdfAnchor} onStatusChange={setStatus} /> : <div className="emptyPdfState"><strong>No PDF available.</strong><span>Register a PDF or recover its server file.</span></div>
          ) : isText(documentRecord) ? (
            textContent ? <TextAnchoredReader text={textContent} highlights={visibleTextHighlights} onSelectionCapture={captureTextAnchor} onStatusChange={setStatus} /> : <div className="emptyPdfState"><strong>No text snapshot available.</strong><span>Register a TXT, Markdown, or DOCX file.</span></div>
          ) : <div className="emptyPdfState"><strong>No source registered yet.</strong><span>Use Register source to load PDF, TXT, Markdown, or DOCX.</span></div>}
        </section>
        <aside className="panel annotationPanel">
          <h3>Annotation</h3>
          <p>{isText(documentRecord) ? "Select text directly from the current extracted text snapshot so Scriptorium can store line and offset anchors for this version." : "Select text directly from the rendered PDF page, then verify the captured passage before saving."}</p>
          <textarea value={selectedText} onChange={(event) => setSelectedText(event.target.value)} placeholder="Selected text appears here." rows={5} disabled={!documentRecord} />
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add your note." rows={5} disabled={!documentRecord} />
          <label>Citation style<select value={style} onChange={(event) => setStyle(event.target.value as CitationStyle)}><option value="sbl-note">SBL note</option><option value="chicago-note">Chicago note</option></select></label>
          <div className="generatedCitation"><span>Generated citation</span><p>{generatedCitation}</p></div>
          {anchor ? <p className="anchorSummary">Anchor captured: {isTextAnchor(anchor) ? `line ${lineLocator(anchor)}, offsets ${anchor.startOffset}-${anchor.endOffset}` : `${anchor.rects.length} rectangle${anchor.rects.length === 1 ? "" : "s"} on PDF page ${anchor.pageNumber}`}.</p> : null}
          <button className="primaryButton" onClick={saveRecord} type="button">Save annotation + citation</button>
          <button className="secondaryButton" onClick={clearRecords} type="button">Clear saved annotations</button>
        </aside>
      </div>
      <section className="annotationList" aria-label="Saved annotations"><div className="sectionHeading"><h3>Saved scholarly records</h3><span>{annotations.length} saved · {currentSnapshotRecords.length} current snapshot</span></div>{documentRecord ? <div className="documentSummary"><strong>{documentRecord.title}</strong><span>{formatLabel} · {documentRecord.filename} · {bytes(documentRecord.size)} {documentRecord.server?.sourceChecksum ? `· checksum ${documentRecord.server.sourceChecksum.slice(0, 12)}` : documentRecord.server?.storageKey ? "· server file" : documentRecord.server ? "· database-linked" : "· local only"}</span></div> : null}{annotations.length === 0 ? <p className="emptyAnnotationState">No annotations saved yet.</p> : <div className="recordsStack">{annotations.map((record) => { const color = highlightColors.find((item) => item.key === record.colorKey) ?? highlightColors[0]; const current = recordMatchesCurrentVersion(record, documentRecord); return <article className="annotationRecord" key={record.id}><div className="recordHeader"><span className="recordColor" style={{ background: color.color }} /><strong>{color.defaultMeaning}</strong><span>{isText(documentRecord) ? "line" : "book page"} {record.bookPageLabel} {current ? "· current snapshot" : "· prior snapshot"} {record.serverAnnotationId ? "· database" : "· local"}</span></div><blockquote>{record.selectedText}</blockquote>{record.note ? <p>{record.note}</p> : null}<div className="recordCitation">{record.citationText}</div></article>; })}</div>}</section>
    </section>
  );
}
