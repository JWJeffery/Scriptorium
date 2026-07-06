"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { highlightColors } from "../lib/highlights";
import { PdfAnchoredPageReader, type PdfPageHighlight, type PdfSelectionAnchor } from "./PdfAnchoredPageReader";

type CitationStyle = "sbl-note" | "chicago-note";
type SourceRecord = { author: string; title: string; place: string; publisher: string; year: string };
type PageMap = { basePdfPageIndex: number; baseBookPage: number; currentPdfPageIndex: number };
type StoredDocument = { id: string; title: string; filename: string; mediaType: string; size: number; source: SourceRecord; pageMap: PageMap };
type SavedAnnotation = { id: string; documentId: string; colorKey: string; selectedText: string; note: string; pdfPageIndex: number; bookPageLabel: string; citationStyle: CitationStyle; citationText: string; anchor?: PdfSelectionAnchor; createdAt: string };

const DB_NAME = "scriptorium-file-store";
const DB_VERSION = 1;
const PDF_STORE = "pdf-blobs";
const DOCUMENT_KEY = "scriptorium.currentDocument";
const ANNOTATIONS_KEY = "scriptorium.annotations";
const EMPTY_SOURCE: SourceRecord = { author: "", title: "", place: "", publisher: "", year: "" };
const DEFAULT_PAGE_MAP: PageMap = { basePdfPageIndex: 1, baseBookPage: 1, currentPdfPageIndex: 1 };

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function bytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PDF_STORE)) request.result.createObjectStore(PDF_STORE);
    };
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

function readDocument() {
  const raw = localStorage.getItem(DOCUMENT_KEY);
  return raw ? (JSON.parse(raw) as StoredDocument) : null;
}

function readAnnotations() {
  const raw = localStorage.getItem(ANNOTATIONS_KEY);
  return raw ? (JSON.parse(raw) as SavedAnnotation[]) : [];
}

function saveDocument(document: StoredDocument) {
  localStorage.setItem(DOCUMENT_KEY, JSON.stringify(document));
}

function saveAnnotations(records: SavedAnnotation[]) {
  localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(records));
}

function bookPage(pageMap: PageMap) {
  return String(pageMap.baseBookPage + pageMap.currentPdfPageIndex - pageMap.basePdfPageIndex);
}

function citation(document: StoredDocument, locator: string, style: CitationStyle) {
  const source = document.source;
  const author = source.author.trim() || "Unknown author";
  const title = source.title.trim() || document.title;
  const imprintParts = [source.place.trim(), source.publisher.trim()].filter(Boolean).join(": ");
  const imprint = [imprintParts, source.year.trim()].filter(Boolean).join(", ");
  const publication = imprint ? ` (${imprint})` : "";
  if (style === "chicago-note") return `${author}, ${title}${publication}, ${locator}.`;
  return `${author}, ${title}${publication}, ${locator}.`;
}

export function ScriptoriumMilestoneOne() {
  const [documentRecord, setDocumentRecord] = useState<StoredDocument | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [annotations, setAnnotations] = useState<SavedAnnotation[]>([]);
  const [selectedColor, setSelectedColor] = useState(highlightColors[0].key);
  const [selectedText, setSelectedText] = useState("");
  const [anchor, setAnchor] = useState<PdfSelectionAnchor | undefined>();
  const [note, setNote] = useState("");
  const [style, setStyle] = useState<CitationStyle>("sbl-note");
  const [status, setStatus] = useState("Register a PDF to begin Milestone 1.");

  useEffect(() => {
    const storedDocument = readDocument();
    setAnnotations(readAnnotations());
    if (!storedDocument) return;
    setDocumentRecord(storedDocument);
    getPdf(storedDocument.id).then((blob) => {
      if (!blob) { setStatus("Recovered records, but no PDF blob was found."); return; }
      setPdfUrl(URL.createObjectURL(blob));
      setStatus("Recovered PDF, page map, annotations, anchors, and citations from browser storage.");
    });
  }, []);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const locator = useMemo(() => documentRecord ? bookPage(documentRecord.pageMap) : "-", [documentRecord]);
  const generatedCitation = useMemo(() => documentRecord ? citation(documentRecord, locator, style) : "Register a document before generating a citation.", [documentRecord, locator, style]);
  const visibleHighlights = useMemo<PdfPageHighlight[]>(() => annotations.flatMap((record) => {
    if (!record.anchor) return [];
    const color = highlightColors.find((item) => item.key === record.colorKey) ?? highlightColors[0];
    return [{ id: record.id, color: color.color, anchor: record.anchor }];
  }), [annotations]);

  const captureAnchor = useCallback((nextAnchor: PdfSelectionAnchor) => {
    setAnchor(nextAnchor);
    setSelectedText(nextAnchor.selectedText);
    setStatus("Captured selected text, context, and highlight rectangles from the PDF page.");
  }, []);

  async function registerPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { setStatus("Milestone 1 accepts PDFs only."); return; }
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const documentId = id("doc");
    const title = file.name.replace(/\.pdf$/i, "");
    const nextDocument: StoredDocument = { id: documentId, title, filename: file.name, mediaType: file.type, size: file.size, source: { ...EMPTY_SOURCE, title }, pageMap: DEFAULT_PAGE_MAP };
    await putPdf(documentId, file);
    saveDocument(nextDocument);
    saveAnnotations([]);
    setDocumentRecord(nextDocument);
    setAnnotations([]);
    setPageCount(0);
    setSelectedText("");
    setAnchor(undefined);
    setPdfUrl(URL.createObjectURL(file));
    setStatus("PDF registered and ready for PDF.js text-layer annotation.");
  }

  function updateDocument(nextDocument: StoredDocument) {
    setDocumentRecord(nextDocument);
    saveDocument(nextDocument);
  }

  function updateSource(field: keyof SourceRecord, value: string) {
    if (!documentRecord) return;
    updateDocument({ ...documentRecord, title: field === "title" ? value : documentRecord.title, source: { ...documentRecord.source, [field]: value } });
  }

  function updatePageMap(field: keyof PageMap, value: number) {
    if (!documentRecord) return;
    updateDocument({ ...documentRecord, pageMap: { ...documentRecord.pageMap, [field]: Number.isFinite(value) ? value : 1 } });
  }

  function goToPage(page: number) {
    if (!documentRecord) return;
    const upper = pageCount > 0 ? pageCount : page;
    setAnchor(undefined);
    updatePageMap("currentPdfPageIndex", Math.min(Math.max(page, 1), upper));
  }

  function saveRecord() {
    if (!documentRecord) { setStatus("Register a PDF before saving an annotation."); return; }
    if (!selectedText.trim()) { setStatus("Capture or enter selected text before saving."); return; }
    const record: SavedAnnotation = { id: id("ann"), documentId: documentRecord.id, colorKey: selectedColor, selectedText: selectedText.trim(), note: note.trim(), pdfPageIndex: documentRecord.pageMap.currentPdfPageIndex, bookPageLabel: locator, citationStyle: style, citationText: generatedCitation, anchor, createdAt: new Date().toISOString() };
    const next = [record, ...annotations];
    setAnnotations(next);
    saveAnnotations(next);
    setSelectedText("");
    setAnchor(undefined);
    setNote("");
    setStatus("Saved annotation, anchor, page locator, note, and citation.");
  }

  function clearRecords() {
    localStorage.setItem(ANNOTATIONS_KEY, "[]");
    setAnnotations([]);
    setSelectedText("");
    setAnchor(undefined);
    setNote("");
    setStatus("Cleared annotation records for the current browser workspace.");
  }

  const currentPage = documentRecord?.pageMap.currentPdfPageIndex ?? 1;

  return (
    <section className="workflow" aria-label="Scriptorium milestone 1 workflow">
      <div className="workflowHeader">
        <div><p className="eyebrow">Milestone 1</p><h2>PDF scholarly workflow</h2><p>Register one PDF, map its book page, capture text from the PDF.js layer, save a highlight note, and recover the record after reload.</p></div>
        <label className="uploadButton">Register PDF<input type="file" accept="application/pdf" onChange={registerPdf} /></label>
      </div>
      <p className="statusLine">{status}</p>
      <div className="milestoneGrid">
        <aside className="panel controlsPanel">
          <h3>Source metadata</h3>
          <label>Title<input value={documentRecord?.source.title ?? ""} onChange={(event) => updateSource("title", event.target.value)} disabled={!documentRecord} /></label>
          <label>Author / editor<input value={documentRecord?.source.author ?? ""} onChange={(event) => updateSource("author", event.target.value)} disabled={!documentRecord} /></label>
          <div className="twoColumnInputs"><label>Place<input value={documentRecord?.source.place ?? ""} onChange={(event) => updateSource("place", event.target.value)} disabled={!documentRecord} /></label><label>Year<input value={documentRecord?.source.year ?? ""} onChange={(event) => updateSource("year", event.target.value)} disabled={!documentRecord} /></label></div>
          <label>Publisher<input value={documentRecord?.source.publisher ?? ""} onChange={(event) => updateSource("publisher", event.target.value)} disabled={!documentRecord} /></label>
          <h3>Page map</h3>
          <div className="twoColumnInputs"><label>PDF page<input type="number" min="1" max={pageCount || undefined} value={currentPage} onChange={(event) => goToPage(Number(event.target.value))} disabled={!documentRecord} /></label><label>Book page<input value={locator} readOnly /></label></div>
          <div className="pageStepper"><button type="button" onClick={() => goToPage(currentPage - 1)} disabled={!documentRecord || currentPage <= 1}>Previous</button><span>{pageCount ? `${currentPage} / ${pageCount}` : "No page count yet"}</span><button type="button" onClick={() => goToPage(currentPage + 1)} disabled={!documentRecord || (pageCount > 0 && currentPage >= pageCount)}>Next</button></div>
          <div className="mappingFormula"><span>Mapping rule</span><label>PDF page<input type="number" min="1" value={documentRecord?.pageMap.basePdfPageIndex ?? 1} onChange={(event) => updatePageMap("basePdfPageIndex", Number(event.target.value))} disabled={!documentRecord} /></label><label>= book page<input type="number" value={documentRecord?.pageMap.baseBookPage ?? 1} onChange={(event) => updatePageMap("baseBookPage", Number(event.target.value))} disabled={!documentRecord} /></label></div>
          <h3>Highlight color</h3><div className="workflowPalette">{highlightColors.map((color) => <button className={selectedColor === color.key ? "workflowSwatch active" : "workflowSwatch"} key={color.key} onClick={() => setSelectedColor(color.key)} type="button"><span style={{ background: color.color }} />{color.defaultMeaning}</button>)}</div>
        </aside>
        <section className="pdfPanel" aria-label="PDF display">{pdfUrl ? <PdfAnchoredPageReader fileUrl={pdfUrl} pageNumber={currentPage} highlights={visibleHighlights} onPageCountChange={setPageCount} onSelectionCapture={captureAnchor} onStatusChange={setStatus} /> : <div className="emptyPdfState"><strong>No PDF registered yet.</strong><span>Use Register PDF to load the first source document.</span></div>}</section>
        <aside className="panel annotationPanel">
          <h3>Annotation</h3><p>Select text directly from the rendered PDF page, then verify the captured passage before saving.</p>
          <textarea value={selectedText} onChange={(event) => setSelectedText(event.target.value)} placeholder="Selected PDF text appears here." rows={5} disabled={!documentRecord} />
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add your note." rows={5} disabled={!documentRecord} />
          <label>Citation style<select value={style} onChange={(event) => setStyle(event.target.value as CitationStyle)}><option value="sbl-note">SBL note</option><option value="chicago-note">Chicago note</option></select></label>
          <div className="generatedCitation"><span>Generated citation</span><p>{generatedCitation}</p></div>
          {anchor ? <p className="anchorSummary">Anchor captured: {anchor.rects.length} rectangle{anchor.rects.length === 1 ? "" : "s"} on PDF page {anchor.pageNumber}.</p> : null}
          <button className="primaryButton" onClick={saveRecord} type="button">Save annotation + citation</button><button className="secondaryButton" onClick={clearRecords} type="button">Clear saved annotations</button>
        </aside>
      </div>
      <section className="annotationList" aria-label="Saved annotations"><div className="sectionHeading"><h3>Saved scholarly records</h3><span>{annotations.length} saved</span></div>{documentRecord ? <div className="documentSummary"><strong>{documentRecord.title}</strong><span>{documentRecord.filename} · {bytes(documentRecord.size)}</span></div> : null}{annotations.length === 0 ? <p className="emptyAnnotationState">No annotations saved yet.</p> : <div className="recordsStack">{annotations.map((record) => { const color = highlightColors.find((item) => item.key === record.colorKey) ?? highlightColors[0]; return <article className="annotationRecord" key={record.id}><div className="recordHeader"><span className="recordColor" style={{ background: color.color }} /><strong>{color.defaultMeaning}</strong><span>PDF page {record.pdfPageIndex} · book page {record.bookPageLabel}</span></div><blockquote>{record.selectedText}</blockquote>{record.note ? <p>{record.note}</p> : null}<div className="recordCitation">{record.citationText}</div></article>; })}</div>}</section>
    </section>
  );
}
