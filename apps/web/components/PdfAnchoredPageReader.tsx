"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type PdfViewport = { width: number; height: number; transform: number[] };
type PdfMetadata = { info?: Record<string, unknown>; metadata?: { get: (key: string) => string | null } | null };
type PdfPage = {
  getViewport: (args: { scale: number }) => PdfViewport;
  getTextContent: () => Promise<{ items: unknown[] }>;
  render: (args: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void> };
};
type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  getMetadata?: () => Promise<PdfMetadata>;
  destroy: () => Promise<void> | void;
};
type TextItemLike = { str: string; transform: number[]; width?: number; height?: number };
type TextRun = { index: number; text: string; left: number; top: number; fontSize: number; width?: number };
export type PdfAuthoritativeWord = { text: string; left: number; top: number; width: number; height: number; confidence: number };

export type PdfAnchorRect = { left: number; top: number; width: number; height: number };
export type PdfSelectionAnchor = {
  selectedText: string;
  pageNumber: number;
  beforeContext: string;
  afterContext: string;
  rects: PdfAnchorRect[];
};
export type PdfPageHighlight = { id: string; color: string; anchor: PdfSelectionAnchor };
export type PdfEmbeddedMetadata = { title?: string; author?: string; keywords?: string; subject?: string };

type Props = {
  fileUrl: string;
  pageNumber: number;
  highlights: PdfPageHighlight[];
  onPageCountChange: (pageCount: number) => void;
  onSelectionCapture: (anchor: PdfSelectionAnchor) => void;
  onStatusChange: (status: string) => void;
  onMetadataExtracted?: (metadata: PdfEmbeddedMetadata) => void;
  // Independently-derived text for the current page (server extraction on
  // ingest, or a real OCR pass) - see api/milestone-sixteen/page-text.
  // When present, a captured selection that doesn't appear anywhere in it
  // gets flagged as possibly corrupted rather than reported as a normal
  // successful capture. Optional and silently skipped when absent (e.g. no
  // extraction/OCR has ever run for this document) - absence of this check
  // is not itself a signal that a capture is trustworthy.
  authoritativePageText?: string | null;
  // Word-level positions from a real OCR pass on this page (same source
  // route). When present, these *replace* pdf.js's own text layer for
  // building the selectable spans - not just a warning after the fact, an
  // actually-correct layer for pages OCR ran on. pdf.js's own extraction
  // (buildTextRuns below) remains the fallback when this is absent, which
  // is the normal case for a genuinely good, non-scanned PDF.
  authoritativeWords?: PdfAuthoritativeWord[] | null;
};

function isTextItem(item: unknown): item is TextItemLike {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

function cleanMetadataValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function embeddedMetadataFrom(pdfMetadata: PdfMetadata): PdfEmbeddedMetadata {
  const info = pdfMetadata.info ?? {};
  const metadata = pdfMetadata.metadata;
  const title = cleanMetadataValue(info.Title) || cleanMetadataValue(metadata?.get("dc:title"));
  const author = cleanMetadataValue(info.Author) || cleanMetadataValue(metadata?.get("dc:creator"));
  const subject = cleanMetadataValue(info.Subject) || cleanMetadataValue(metadata?.get("dc:description"));
  const keywords = cleanMetadataValue(info.Keywords) || cleanMetadataValue(metadata?.get("pdf:Keywords"));
  return { title: title || undefined, author: author || undefined, subject: subject || undefined, keywords: keywords || undefined };
}

async function renderCanvas(page: PdfPage, canvas: HTMLCanvasElement, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) throw new Error("Canvas unavailable.");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({ canvasContext, viewport }).promise;
  return viewport;
}

async function buildTextRuns(page: PdfPage, scale: number) {
  const viewport = page.getViewport({ scale });
  const textContent = await page.getTextContent();
  return textContent.items.filter(isTextItem).map((item, index) => {
    const transform = pdfjsLib.Util.transform(viewport.transform, item.transform as number[]);
    const fontSize = Math.max(Math.hypot(transform[2], transform[3]), 8);
    const width = typeof item.width === "number" ? item.width * scale : undefined;
    return {
      index,
      text: String(item.str),
      left: transform[4],
      top: transform[5] - fontSize,
      fontSize,
      width
    } satisfies TextRun;
  });
}

function runsFromWords(words: PdfAuthoritativeWord[]): TextRun[] {
  return words.map((word, index) => ({
    index,
    text: word.text,
    left: word.left,
    top: word.top,
    fontSize: Math.max(word.height, 8),
    width: word.width
  }));
}

function contextFor(textRuns: TextRun[], selectedText: string) {
  const pageText = textRuns.map((run) => run.text).join(" ").replace(/\s+/g, " ").trim();
  const start = pageText.indexOf(selectedText);
  if (start < 0) return { beforeContext: "", afterContext: "" };
  return {
    beforeContext: pageText.slice(Math.max(0, start - 160), start).trim(),
    afterContext: pageText.slice(start + selectedText.length, start + selectedText.length + 160).trim()
  };
}

function normalizeForCompare(value: string) {
  // Case-insensitive, whitespace-collapsed, punctuation-light comparison -
  // OCR and pdf.js text-layer extraction can legitimately disagree on
  // exact punctuation/spacing for genuinely correct text, so this only
  // needs to be loose enough to not false-flag real matches, not exact.
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// A selection this short (e.g. a single short word) is too easy to match
// coincidentally against unrelated authoritative text to be a meaningful
// check either way, so it's skipped rather than risking a false "verified".
const MIN_LENGTH_TO_CHECK = 8;

function rectsFor(range: Range, frame: HTMLDivElement) {
  const frameRect = frame.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((rect) => ({
    left: rect.left - frameRect.left,
    top: rect.top - frameRect.top,
    width: rect.width,
    height: rect.height
  })).filter((rect) => rect.width > 0 && rect.height > 0);
}

export function PdfAnchoredPageReader({ fileUrl, pageNumber, highlights, onPageCountChange, onSelectionCapture, onStatusChange, onMetadataExtracted, authoritativePageText, authoritativeWords }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const [pdfTextRuns, setPdfTextRuns] = useState<TextRun[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [documentLoadKey, setDocumentLoadKey] = useState(0);

  const usingOcrLayer = Boolean(authoritativeWords && authoritativeWords.length > 0);
  const textRuns = usingOcrLayer ? runsFromWords(authoritativeWords!) : pdfTextRuns;

  useEffect(() => {
    if (usingOcrLayer) {
      onStatusChange(`Using this page's real OCR text for selection instead of the PDF's own text layer (${authoritativeWords!.length} word${authoritativeWords!.length === 1 ? "" : "s"}).`);
    }
    // Only fire when the OCR layer actually becomes active for the current
    // page - not on every unrelated status change elsewhere in the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingOcrLayer, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    async function loadDocument() {
      setIsLoading(true);
      try {
        const pdfDocument = (await pdfjsLib.getDocument(fileUrl).promise) as unknown as PdfDocument;
        if (cancelled) return;
        if (documentRef.current) await documentRef.current.destroy();
        documentRef.current = pdfDocument;
        onPageCountChange(pdfDocument.numPages);
        setDocumentLoadKey((value) => value + 1);
        if (pdfDocument.getMetadata && onMetadataExtracted) {
          try {
            const metadata = embeddedMetadataFrom(await pdfDocument.getMetadata());
            if (metadata.title || metadata.author || metadata.subject || metadata.keywords) onMetadataExtracted(metadata);
          } catch {
            // PDF metadata is optional and often malformed; ignore metadata failures.
          }
        }
        onStatusChange(`PDF.js loaded ${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"}.`);
      } catch {
        onStatusChange("PDF.js could not load this PDF.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadDocument();
    return () => { cancelled = true; };
  }, [fileUrl, onMetadataExtracted, onPageCountChange, onStatusChange]);

  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      const pdfDocument = documentRef.current;
      const canvas = canvasRef.current;
      if (!pdfDocument || !canvas) return;
      setIsLoading(true);
      try {
        const safePageNumber = Math.min(Math.max(pageNumber, 1), pdfDocument.numPages);
        const page = await pdfDocument.getPage(safePageNumber);
        const scale = 1;
        const viewport = await renderCanvas(page, canvas, scale);
        const runs = await buildTextRuns(page, scale);
        if (cancelled) return;
        setPageSize({ width: viewport.width, height: viewport.height });
        setPdfTextRuns(runs);
        onStatusChange(`Rendered PDF page ${safePageNumber} with selectable text layer.`);
      } catch {
        if (!cancelled) onStatusChange("Could not render this PDF page.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    renderPage();
    return () => { cancelled = true; };
  }, [pageNumber, documentLoadKey, onStatusChange]);

  function captureSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\s+/g, " ").trim();
    const frame = frameRef.current;
    const textLayer = textLayerRef.current;
    if (!selection || selection.rangeCount === 0 || !selectedText || !frame || !textLayer) return;
    const range = selection.getRangeAt(0);
    if (!textLayer.contains(range.commonAncestorContainer)) return;
    const rects = rectsFor(range, frame);
    selection.removeAllRanges();
    onSelectionCapture({ selectedText, pageNumber, ...contextFor(textRuns, selectedText), rects });

    if (!usingOcrLayer && authoritativePageText && selectedText.length >= MIN_LENGTH_TO_CHECK) {
      const corroborated = normalizeForCompare(authoritativePageText).includes(normalizeForCompare(selectedText));
      if (!corroborated) {
        onStatusChange(
          `Captured "${selectedText.slice(0, 60)}${selectedText.length > 60 ? "\u2026" : ""}" - but this text does not appear in this page's independently extracted/OCR'd text. The source PDF's embedded text layer may be corrupted here (this happens with malformed fonts). Verify very carefully before saving, or consider that this capture may not reflect the real content of the page.`
        );
        return;
      }
    }

    onStatusChange(`Captured selected text and ${rects.length} anchor rectangle${rects.length === 1 ? "" : "s"} from the ${usingOcrLayer ? "verified OCR" : "PDF.js"} text layer.`);
  }

  return (
    <div className="pdfReaderShell">
      {isLoading ? <div className="pdfLoading">Rendering PDF page…</div> : null}
      <div className="pdfPageFrame" onMouseUp={captureSelection} ref={frameRef} style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}>
        <canvas ref={canvasRef} className="pdfCanvas" />
        <div className="pdfHighlightLayer" aria-hidden="true">
          {highlights.filter((highlight) => highlight.anchor.pageNumber === pageNumber).flatMap((highlight) =>
            highlight.anchor.rects.map((rect, index) => (
              <span className="pdfHighlightBox" key={`${highlight.id}-${index}`} style={{ background: highlight.color, left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
            ))
          )}
        </div>
        <div className="pdfTextLayer" aria-label="Selectable PDF text layer" ref={textLayerRef}>
          {textRuns.map((run) => (
            <span className="pdfTextRun" data-text-run-index={run.index} key={`${run.index}-${run.text}`} style={{ left: run.left, top: run.top, fontSize: run.fontSize, width: run.width }}>
              {run.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
