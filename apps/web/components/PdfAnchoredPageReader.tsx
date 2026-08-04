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
export type PdfAuthoritativeWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  blockNum?: number;
  lineNum?: number;
};

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
  if (words.length === 0) return [];
  // Group words into line-level spans rather than one span per word. A
  // normal click-and-drag selection needs to span multiple words, and
  // browsers don't reliably extend a Selection across many small real gaps
  // between separate absolutely-positioned elements with nothing connecting
  // them - each word being its own span meant a drag could only ever pick
  // up one word at a time. pdf.js's own text runs never hit this because
  // they already group whole phrases/lines into a single span; this brings
  // OCR-derived runs in line with that. Word-level position data is still
  // what's stored server-side (useful for finer-grained needs later) - this
  // only changes how it's grouped for rendering the selectable layer.
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  type Line = { words: PdfAuthoritativeWord[]; top: number; bottom: number };
  const lines: Line[] = [];
  for (const word of sorted) {
    const wordMid = word.top + word.height / 2;
    const line = lines.find((candidate) => wordMid >= candidate.top && wordMid <= candidate.bottom);
    if (line) {
      line.words.push(word);
      line.top = Math.min(line.top, word.top);
      line.bottom = Math.max(line.bottom, word.top + word.height);
    } else {
      lines.push({ words: [word], top: word.top, bottom: word.top + word.height });
    }
  }
  return lines
    .sort((a, b) => a.top - b.top)
    .map((line, index) => {
      const lineWords = [...line.words].sort((a, b) => a.left - b.left);
      const left = Math.min(...lineWords.map((word) => word.left));
      const right = Math.max(...lineWords.map((word) => word.left + word.width));
      const top = Math.min(...lineWords.map((word) => word.top));
      const bottom = Math.max(...lineWords.map((word) => word.top + word.height));
      return {
        index,
        text: lineWords.map((word) => word.text).join(" "),
        left,
        top,
        fontSize: Math.max(bottom - top, 8),
        width: right - left
      } satisfies TextRun;
    });
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

function rectsFor(range: Range, frame: HTMLDivElement, scale: number) {
  const frameRect = frame.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((rect) => ({
    left: (rect.left - frameRect.left) / scale,
    top: (rect.top - frameRect.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale
  })).filter((rect) => rect.width > 0 && rect.height > 0);
}

type DragRect = { left: number; top: number; width: number; height: number };

function pointInFrame(event: { clientX: number; clientY: number }, frame: HTMLDivElement, scale: number) {
  const frameRect = frame.getBoundingClientRect();
  return { x: (event.clientX - frameRect.left) / scale, y: (event.clientY - frameRect.top) / scale };
}

function rectFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): DragRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

export function PdfAnchoredPageReader({ fileUrl, pageNumber, highlights, onPageCountChange, onSelectionCapture, onStatusChange, onMetadataExtracted, authoritativePageText, authoritativeWords }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const [pdfTextRuns, setPdfTextRuns] = useState<TextRun[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [documentLoadKey, setDocumentLoadKey] = useState(0);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // Real scanned pages - especially two-page spreads scanned as a single
  // image, like this book - can be wider than the middle grid column has
  // room for, at some perfectly normal browser window widths. Rather than
  // letting the page overflow/clip or forcing a horizontal scrollbar
  // that's easy to miss, this tracks how much width is actually available
  // and shrinks the whole page (canvas, highlights, drag-selection layer -
  // everything, via a single CSS transform on the shared parent) to fit,
  // without changing anything about the pixel coordinate space every OCR
  // word position, highlight rectangle, and drag rectangle is computed in.
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") setContainerWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Never scale up past the page's real size - only shrink to fit when the
  // available space is genuinely narrower than the page.
  const fitScale = pageSize.width > 0 && containerWidth > 0 ? Math.min(1, containerWidth / pageSize.width) : 1;

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

  // Two consecutive attempts at making the browser's native text selection
  // work over an invisible, synthetic text layer (over an OCR'd page image)
  // both failed on the same underlying issue: browsers don't reliably map
  // mouse position to the correct character within text that isn't the
  // page's own real, natively-laid-out content - not even with a computed
  // CSS scaleX correction. Real word positions from OCR are trustworthy
  // data; the problem was routing selection through browser text hit-testing
  // at all. This replaces that entirely for OCR pages: track the drag as a
  // plain rectangle in page coordinates, then directly test which known
  // word boxes it covers - simple, reliable geometry, no browser text-layout
  // guessing involved anywhere in the path.
  function handleOcrMouseDown(event: React.MouseEvent) {
    if (!usingOcrLayer) return;
    const frame = frameRef.current;
    if (!frame) return;
    dragStartRef.current = pointInFrame(event, frame, fitScale);
    setDragRect(null);
  }

  function handleOcrMouseMove(event: React.MouseEvent) {
    if (!usingOcrLayer || !dragStartRef.current) return;
    const frame = frameRef.current;
    if (!frame) return;
    setDragRect(rectFromPoints(dragStartRef.current, pointInFrame(event, frame, fitScale)));
  }

  function handleOcrMouseUp() {
    const start = dragStartRef.current;
    const rect = dragRect;
    dragStartRef.current = null;
    setDragRect(null);
    if (!usingOcrLayer || !start || !rect || !authoritativeWords) return;
    // A tiny drag (or a plain click) shouldn't be treated as a selection.
    if (rect.width < 3 && rect.height < 3) return;

    // A word counts as selected if its center falls inside the dragged
    // rectangle - more predictable than "any overlap" for a person dragging
    // roughly across the words they mean to select.
    const rawMatched = authoritativeWords.filter((word) => {
      const centerX = word.left + word.width / 2;
      const centerY = word.top + word.height / 2;
      return centerX >= rect.left && centerX <= rect.left + rect.width && centerY >= rect.top && centerY <= rect.top + rect.height;
    });
    if (rawMatched.length === 0) return;

    // A rectangle drag is drawn in screen space and has no idea it might be
    // geometrically sweeping across two visually separate things that
    // happen to share a y-range - e.g. a main paragraph and a smaller
    // marginal citation/attribution block sitting to its right on roughly
    // the same lines. Tesseract's own block_num groups words by the region
    // its layout analysis actually detected, so when the raw match spans
    // more than one block, keep only the block with the most matched words
    // (the one the person was most likely actually trying to select) and
    // drop the rest, rather than silently joining fragments from two
    // unrelated regions into one nonsensical string. Only applies when
    // every matched word actually has a blockNum (older, pre-this-fix
    // stored OCR data won't) - falls back to the old "use everything"
    // behavior otherwise rather than guessing.
    const allHaveBlockInfo = rawMatched.every((word) => typeof word.blockNum === "number");
    let matched = rawMatched;
    let excludedOtherBlockCount = 0;
    if (allHaveBlockInfo) {
      const countsByBlock = new Map<number, number>();
      for (const word of rawMatched) {
        const key = word.blockNum as number;
        countsByBlock.set(key, (countsByBlock.get(key) ?? 0) + 1);
      }
      if (countsByBlock.size > 1) {
        let dominantBlock = rawMatched[0].blockNum as number;
        let dominantCount = 0;
        for (const [block, count] of countsByBlock) {
          if (count > dominantCount) {
            dominantBlock = block;
            dominantCount = count;
          }
        }
        matched = rawMatched.filter((word) => word.blockNum === dominantBlock);
        excludedOtherBlockCount = rawMatched.length - matched.length;
      }
    }
    if (matched.length === 0) return;

    // Reading order: words on the same visual line don't share an exact
    // top coordinate - OCR bounding boxes jitter by a few pixels per word
    // (ascenders, descenders, baseline noise), so sorting by raw top before
    // left treats "There's" and "Church" (both landed at top=191) as
    // belonging before "be said for the" (top=192) even though they're
    // all on the same line - scrambling the reading order into something
    // like "There's Church be said for the...". Tesseract's own
    // blockNum/lineNum (from the TSV line-grouping, not per-word pixel
    // noise) is the authoritative answer to "which line is this word on" -
    // use that when every matched word has it. Falls back to a
    // tolerance-based top comparison (same line if vertical midpoints are
    // within a few pixels) for older stored OCR data that predates
    // lineNum being captured, rather than crashing or guessing wrong.
    const allHaveLineInfo = matched.every((word) => typeof word.blockNum === "number" && typeof word.lineNum === "number");
    const sorted = allHaveLineInfo
      ? [...matched].sort(
          (a, b) => (a.blockNum as number) - (b.blockNum as number) || (a.lineNum as number) - (b.lineNum as number) || a.left - b.left
        )
      : [...matched].sort((a, b) => {
          const aMid = a.top + a.height / 2;
          const bMid = b.top + b.height / 2;
          const sameLine = Math.abs(aMid - bMid) < Math.min(a.height, b.height) * 0.6;
          return sameLine ? a.left - b.left : a.top - b.top;
        });
    const selectedText = sorted.map((word) => word.text).join(" ");
    const rects = sorted.map((word) => ({ left: word.left, top: word.top, width: word.width, height: word.height }));

    onSelectionCapture({ selectedText, pageNumber, ...contextFor(textRuns, selectedText), rects });
    const coverageNote = excludedOtherBlockCount > 0
      ? ` (${excludedOtherBlockCount} word${excludedOtherBlockCount === 1 ? "" : "s"} from an overlapping but visually separate region - e.g. a marginal note or citation - were excluded; redraw a tighter selection if you meant to include it.)`
      : "";
    onStatusChange(
      `Captured ${sorted.length} word${sorted.length === 1 ? "" : "s"} and ${rects.length} anchor rectangle${rects.length === 1 ? "" : "s"} from real OCR word positions (no browser text-selection involved).${coverageNote}`
    );
  }

  function captureSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\s+/g, " ").trim();
    const frame = frameRef.current;
    const textLayer = textLayerRef.current;
    if (!selection || selection.rangeCount === 0 || !selectedText || !frame || !textLayer) return;
    const range = selection.getRangeAt(0);
    if (!textLayer.contains(range.commonAncestorContainer)) return;
    const rects = rectsFor(range, frame, fitScale);
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
      <div
        className="pdfFrameViewport"
        ref={viewportRef}
        style={{ height: pageSize.height ? pageSize.height * fitScale : undefined }}
      >
        <div
          className="pdfPageFrame"
          onMouseUp={usingOcrLayer ? handleOcrMouseUp : captureSelection}
          onMouseDown={usingOcrLayer ? handleOcrMouseDown : undefined}
          onMouseMove={usingOcrLayer ? handleOcrMouseMove : undefined}
          ref={frameRef}
          style={{
            width: pageSize.width || undefined,
            height: pageSize.height || undefined,
            transform: fitScale < 1 ? `scale(${fitScale})` : undefined,
            transformOrigin: "top left"
          }}
        >
          <canvas ref={canvasRef} className="pdfCanvas" />
          <div className="pdfHighlightLayer" aria-hidden="true">
            {highlights.filter((highlight) => highlight.anchor.pageNumber === pageNumber).flatMap((highlight) =>
              highlight.anchor.rects.map((rect, index) => (
                <span className="pdfHighlightBox" key={`${highlight.id}-${index}`} style={{ background: highlight.color, left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
              ))
            )}
            {usingOcrLayer && dragRect ? (
              <span className="pdfDragRect" style={{ left: dragRect.left, top: dragRect.top, width: dragRect.width, height: dragRect.height }} />
            ) : null}
          </div>
          <div
            className="pdfTextLayer"
            aria-label="Selectable PDF text layer"
            ref={textLayerRef}
            style={usingOcrLayer ? { pointerEvents: "none", userSelect: "none", cursor: "default" } : undefined}
          >
            {textRuns.map((run) => (
              <span className="pdfTextRun" data-text-run-index={run.index} key={`${run.index}-${run.text}`} style={{ left: run.left, top: run.top, fontSize: run.fontSize, width: run.width }}>
                {run.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
