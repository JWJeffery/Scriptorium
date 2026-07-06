"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { highlightColors } from "../lib/highlights";
import { PdfPageReader } from "./PdfPageReader";

type CitationStyle = "chicago-note" | "sbl-note";

type SourceMetadata = {
  author: string;
  title: string;
  place: string;
  publisher: string;
  year: string;
};

type StoredDocument = {
  id: string;
  title: string;
  filename: string;
  mediaType: string;
  size: number;
  createdAt: string;
  source: SourceMetadata;
  pageMap: PageMapState;
};

type PageMapState = {
  basePdfPageIndex: number;
  baseBookPage: number;
  currentPdfPageIndex: number;
};

type AnnotationRecord = {
  id: string;
  documentId: string;
  colorKey: string;
  selectedText: string;
  note: string;
  pdfPageIndex: number;
  bookPageLabel: string;
  citationStyle: CitationStyle;
  citationText: string;
  createdAt: string;
};

const DB_NAME = "scriptorium-file-store";
const DB_VERSION = 1;
const PDF_STORE = "pdf-blobs";
const DOCUMENT_KEY = "scriptorium.currentDocument";
const ANNOTATIONS_KEY = "scriptorium.annotations";

const emptySource: SourceMetadata = {
  author: "",
  title: "",
  place: "",
  publisher: "",
  year: ""
};

const defaultPageMap: PageMapState = {
  basePdfPageIndex: 1,
  baseBookPage: 1,
  currentPdfPageIndex: 1
};

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function openFileDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PDF_STORE)) {
        db.createObjectStore(PDF_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePdfBlob(documentId: string, file: File) {
  const db = await openFileDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE, "readwrite");
    transaction.objectStore(PDF_STORE).put(file, documentId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function loadPdfBlob(documentId: string): Promise<Blob | null> {
  const db = await openFileDatabase();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE, "readonly");
    const request = transaction.objectStore(PDF_STORE).get(documentId);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

function readStoredDocument(): StoredDocument | null {
  try {
    const raw = localStorage.getItem(DOCUMENT_KEY);
    return raw ? (JSON.parse(raw) as StoredDocument) : null;
  } catch {
    return null;
  }
}

function writeStoredDocument(document: StoredDocument) {
  localStorage.setItem(DOCUMENT_KEY, JSON.stringify(document));
}

function readAnnotations(): AnnotationRecord[] {
  try {
    const raw = localStorage.getItem(ANNOTATIONS_KEY);
    return raw ? (JSON.parse(raw) as AnnotationRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAnnotations(records: AnnotationRecord[]) {
  localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(records));
}

function buildBookPageLabel(pageMap: PageMapState) {
  return String(pageMap.baseBookPage + pageMap.currentPdfPageIndex - pageMap.basePdfPageIndex);
}

function buildCitation(document: StoredDocument, bookPageLabel: string, style: CitationStyle) {
  const source = document.source;
  const author = source.author.trim() || "Unknown author";
  const title = source.title.trim() || document.title || document.filename;
  const place = source.place.trim();
  const publisher = source.publisher.trim();
  const year = source.year.trim();
  const imprintParts = [place, publisher].filter(Boolean).join(": ");
  const imprint = [imprintParts, year].filter(Boolean).join(", ");
  const publication = imprint ? ` (${imprint})` : "";

  if (style === "sbl-note") {
    return `${author}, ${title}${publication}, ${bookPageLabel}.`;
  }

  return `${author}, ${title}${publication}, ${bookPageLabel}.`;
}

export function ScriptoriumWorkflow() {
  const [documentRecord, setDocumentRecord] = useState<StoredDocument | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [selectedColor, setSelectedColor] = useState(highlightColors[0].key);
  const [selectedText, setSelectedText] = useState("");
  const [note, setNote] = useState("");
  const [citationStyle, setCitationStyle] = useState<CitationStyle>("sbl-note");
  const [status, setStatus] = useState("Load or register a PDF to begin.");

  const handleStatusChange = useCallback((message: string) => {
    setStatus(message);
  }, []);

  const handlePageCountChange = useCallback((nextPageCount: number) => {
    setPageCount(nextPageCount);
  }, []);

  const handleSelectionCapture = useCallback((capturedText: string) => {
    setSelectedText(capturedText);
    setStatus("Captured selected text from the PDF page. Add a note, verify the locator, and save.");
  }, []);

  useEffect(() => {
    const storedDocument = readStoredDocument();
    const storedAnnotations = readAnnotations();
    setAnnotations(storedAnnotations);

    if (!storedDocument) return;

    setDocumentRecord(storedDocument);
    setStatus("Recovered document metadata and annotations. Rehydrating PDF blob.");

    loadPdfBlob(storedDocument.id)
      .then((blob) => {
        if (!blob) {
          setStatus("Recovered metadata and annotations, but the PDF blob was not found in IndexedDB.");
          return;
        }
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
        setStatus("Recovered PDF, page map, annotations, and citation records from browser storage.");
      })
      .catch(() => setStatus("Recovered metadata, but could not reopen the stored PDF blob."));
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const bookPageLabel = useMemo(() => {
    return documentRecord ? buildBookPageLabel(documentRecord.pageMap) : "—";
  }, [documentRecord]);

  const currentCitation = useMemo(() => {
    if (!documentRecord) return "Register a document before generating a citation.";
    return buildCitation(documentRecord, bookPageLabel, citationStyle);
  }, [bookPageLabel, citationStyle, documentRecord]);

  async function handlePdfUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setStatus("Only PDF registration is implemented in Milestone 1.");
      return;
    }

    if (pdfUrl) URL.revokeObjectURL(pdfUrl);

    const id = createId("doc");
    const nextDocument: StoredDocument = {
      id,
      title: file.name.replace(/\.pdf$/i, ""),
      filename: file.name,
      mediaType: file.type,
      size: file.size,
      createdAt: new Date().toISOString(),
      source: {
        ...emptySource,
        title: file.name.replace(/\.pdf$/i, "")
      },
      pageMap: defaultPageMap
    };

    await savePdfBlob(id, file);
    writeStoredDocument(nextDocument);
    writeAnnotations([]);
    setDocumentRecord(nextDocument);
    setAnnotations([]);
    setPageCount(0);
    setPdfUrl(URL.createObjectURL(file));
    setStatus("PDF registered, stored in IndexedDB, and ready for PDF.js rendering.");
  }

  function updateDocument(nextDocument: StoredDocument) {
    setDocumentRecord(nextDocument);
    writeStoredDocument(nextDocument);
  }

  function updateSource(field: keyof SourceMetadata, value: string) {
    if (!documentRecord) return;
    updateDocument({
      ...documentRecord,
      title: field === "title" ? value : documentRecord.title,
      source: {
        ...documentRecord.source,
        [field]: value
      }
    });
  }

  function updatePageMap(field: keyof PageMapState, value: number) {
    if (!documentRecord) return;
    const cleanValue = Number.isFinite(value) ? value : 1;
    updateDocument({
      ...documentRecord,
      pageMap: {
        ...documentRecord.pageMap,
        [field]: cleanValue
      }
    });
  }

  function goToPdfPage(nextPage: number) {
    if (!documentRecord) return;
    const upperBound = pageCount > 0 ? pageCount : nextPage;
    const safePage = Math.min(Math.max(nextPage, 1), upperBound);
    updatePageMap("currentPdfPageIndex", safePage);
  }

  function createAnnotation() {
    if (!documentRecord) {
      setStatus("Register a PDF before creating an annotation.");
      return;
    }

    if (!selectedText.trim()) {
      setStatus("Select text from the PDF.js text layer, or paste a passage before saving the annotation.");
      return;
    }

    const citationText = buildCitation(documentRecord, bookPageLabel, citationStyle);
    const nextAnnotation: AnnotationRecord = {
      id: createId("ann"),
      documentId: documentRecord.id,
      colorKey: selectedColor,
      selectedText: selectedText.trim(),
      note: note.trim(),
      pdfPageIndex: documentRecord.pageMap.currentPdfPageIndex,
      bookPageLabel,
      citationStyle,
      citationText,
      createdAt: new Date().toISOString()
    };

    const nextAnnotations = [nextAnnotation, ...annotations];
    setAnnotations(nextAnnotations);
    writeAnnotations(nextAnnotations);
    setSelectedText("");
    setNote("");
    setStatus("Annotation, mapped book page, note, and generated citation saved.");
  }

  function clearWorkspace() {
    localStorage.removeItem(DOCUMENT_KEY);
    localStorage.removeItem(ANNOTATIONS_KEY);
    setDocumentRecord(null);
    setAnnotations([]);
    setSelectedText("");
    setNote("");
    setPageCount(0);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    setStatus("Local workspace metadata cleared. IndexedDB PDF blobs are left in place for now.");
  }

  const currentPdfPage = documentRecord?.pageMap.currentPdfPageIndex ?? 1;

  return (
    <section className="workflow" aria-label="Scriptorium milestone 1 workflow">
      <div className="workflowHeader">
        <div>
          <p className="eyebrow">Milestone 1</p>
          <h2>PDF scholarly workflow</h2>
          <p>
            Register one PDF, map its book page, capture a text-layer selection, save a highlight note,
            and generate a citation that survives browser reload.
          </p>
        </div>
        <label className="uploadButton">
          Register PDF
          <input type="file" accept="application/pdf" onChange={handlePdfUpload} />
        </label>
      </div>

      <p className="statusLine">{status}</p>

      <div className="milestoneGrid">
        <aside className="panel controlsPanel">
          <h3>Source metadata</h3>
          <label>
            Title
            <input
              value={documentRecord?.source.title ?? ""}
              onChange={(event) => updateSource("title", event.target.value)}
              placeholder="Document title"
              disabled={!documentRecord}
            />
          </label>
          <label>
            Author / editor
            <input
              value={documentRecord?.source.author ?? ""}
              onChange={(event) => updateSource("author", event.target.value)}
              placeholder="First Last"
              disabled={!documentRecord}
            />
          </label>
          <div className="twoColumnInputs">
            <label>
              Place
              <input
                value={documentRecord?.source.place ?? ""}
                onChange={(event) => updateSource("place", event.target.value)}
                placeholder="City"
                disabled={!documentRecord}
              />
            </label>
            <label>
              Year
              <input
                value={documentRecord?.source.year ?? ""}
                onChange={(event) => updateSource("year", event.target.value)}
                placeholder="2026"
                disabled={!documentRecord}
              />
            </label>
          </div>
          <label>
            Publisher
            <input
              value={documentRecord?.source.publisher ?? ""}
              onChange={(event) => updateSource("publisher", event.target.value)}
              placeholder="Publisher"
              disabled={!documentRecord}
            />
          </label>

          <h3>Page map</h3>
          <div className="twoColumnInputs">
            <label>
              PDF page
              <input
                type="number"
                min="1"
                max={pageCount || undefined}
                value={currentPdfPage}
                onChange={(event) => goToPdfPage(Number(event.target.value))}
                disabled={!documentRecord}
              />
            </label>
            <label>
              Book page
              <input value={bookPageLabel} readOnly />
            </label>
          </div>
          <div className="pageStepper">
            <button type="button" onClick={() => goToPdfPage(currentPdfPage - 1)} disabled={!documentRecord || currentPdfPage <= 1}>
              Previous page
            </button>
            <span>{pageCount ? `${currentPdfPage} / ${pageCount}` : "No page count yet"}</span>
            <button type="button" onClick={() => goToPdfPage(currentPdfPage + 1)} disabled={!documentRecord || (pageCount > 0 && currentPdfPage >= pageCount)}>
              Next page
            </button>
          </div>
          <div className="mappingFormula">
            <span>Mapping rule</span>
            <label>
              PDF page
              <input
                type="number"
                min="1"
                value={documentRecord?.pageMap.basePdfPageIndex ?? 1}
                onChange={(event) => updatePageMap("basePdfPageIndex", Number(event.target.value))}
                disabled={!documentRecord}
              />
            </label>
            <label>
              = book page
              <input
                type="number"
                value={documentRecord?.pageMap.baseBookPage ?? 1}
                onChange={(event) => updatePageMap("baseBookPage", Number(event.target.value))}
                disabled={!documentRecord}
              />
            </label>
          </div>

          <h3>Highlight color</h3>
          <div className="workflowPalette">
            {highlightColors.map((color) => (
              <button
                className={selectedColor === color.key ? "workflowSwatch active" : "workflowSwatch"}
                key={color.key}
                onClick={() => setSelectedColor(color.key)}
                type="button"
              >
                <span style={{ background: color.color }} />
                {color.defaultMeaning}
              </button>
            ))}
          </div>
        </aside>

        <section className="pdfPanel" aria-label="PDF display">
          {pdfUrl ? (
            <PdfPageReader
              fileUrl={pdfUrl}
              pageNumber={currentPdfPage}
              onPageCountChange={handlePageCountChange}
              onSelectionCapture={handleSelectionCapture}
              onStatusChange={handleStatusChange}
            />
          ) : (
            <div className="emptyPdfState">
              <strong>No PDF registered yet.</strong>
              <span>Use “Register PDF” to load the first source document.</span>
            </div>
          )}
        </section>

        <aside className="panel annotationPanel">
          <h3>Annotation</h3>
          <p>
            Select text directly from the rendered PDF page. The captured text remains editable here
            before it is saved as a scholarly annotation.
          </p>
          <textarea
            value={selectedText}
            onChange={(event) => setSelectedText(event.target.value)}
            placeholder="Selected PDF text appears here."
            rows={5}
            disabled={!documentRecord}
          />
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add your note."
            rows={5}
            disabled={!documentRecord}
          />
          <label>
            Citation style
            <select value={citationStyle} onChange={(event) => setCitationStyle(event.target.value as CitationStyle)}>
              <option value="sbl-note">SBL note</option>
              <option value="chicago-note">Chicago note</option>
            </select>
          </label>
          <div className="generatedCitation">
            <span>Generated citation</span>
            <p>{currentCitation}</p>
          </div>
          <button className="primaryButton" onClick={createAnnotation} type="button">
            Save annotation + citation
          </button>
          <button className="secondaryButton" onClick={clearWorkspace} type="button">
            Clear local workspace
          </button>
        </aside>
      </div>

      <section className="annotationList" aria-label="Saved annotations">
        <div className="sectionHeading">
          <h3>Saved scholarly records</h3>
          <span>{annotations.length} saved</span>
        </div>
        {documentRecord ? (
          <div className="documentSummary">
            <strong>{documentRecord.title}</strong>
            <span>{documentRecord.filename} · {formatBytes(documentRecord.size)}</span>
          </div>
        ) : null}
        {annotations.length === 0 ? (
          <p className="emptyAnnotationState">No annotations saved yet.</p>
        ) : (
          <div className="recordsStack">
            {annotations.map((annotation) => {
              const color = highlightColors.find((item) => item.key === annotation.colorKey) ?? highlightColors[0];
              return (
                <article className="annotationRecord" key={annotation.id}>
                  <div className="recordHeader">
                    <span className="recordColor" style={{ background: color.color }} />
                    <strong>{color.defaultMeaning}</strong>
                    <span>PDF page {annotation.pdfPageIndex} · book page {annotation.bookPageLabel}</span>
                  </div>
                  <blockquote>{annotation.selectedText}</blockquote>
                  {annotation.note ? <p>{annotation.note}</p> : null}
                  <div className="recordCitation">{annotation.citationText}</div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
