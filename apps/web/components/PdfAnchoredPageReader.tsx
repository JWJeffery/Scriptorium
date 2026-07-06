"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type PdfViewport = { width: number; height: number; transform: number[] };
type PdfPage = {
  getViewport: (args: { scale: number }) => PdfViewport;
  getTextContent: () => Promise<{ items: unknown[] }>;
  render: (args: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void> };
};
type PdfDocument = { numPages: number; getPage: (pageNumber: number) => Promise<PdfPage>; destroy: () => Promise<void> | void };
type TextItemLike = { str: string; transform: number[] };
type TextRun = { index: number; text: string; left: number; top: number; fontSize: number };

export type PdfAnchorRect = { left: number; top: number; width: number; height: number };
export type PdfSelectionAnchor = {
  selectedText: string;
  pageNumber: number;
  beforeContext: string;
  afterContext: string;
  rects: PdfAnchorRect[];
};
export type PdfPageHighlight = { id: string; color: string; anchor: PdfSelectionAnchor };

type Props = {
  fileUrl: string;
  pageNumber: number;
  highlights: PdfPageHighlight[];
  onPageCountChange: (pageCount: number) => void;
  onSelectionCapture: (anchor: PdfSelectionAnchor) => void;
  onStatusChange: (status: string) => void;
};

function isTextItem(item: unknown): item is TextItemLike {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
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
    return {
      index,
      text: String(item.str),
      left: transform[4],
      top: viewport.height - transform[5] - fontSize,
      fontSize
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

function rectsFor(range: Range, frame: HTMLDivElement) {
  const frameRect = frame.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((rect) => ({
    left: rect.left - frameRect.left,
    top: rect.top - frameRect.top,
    width: rect.width,
    height: rect.height
  })).filter((rect) => rect.width > 0 && rect.height > 0);
}

export function PdfAnchoredPageReader({ fileUrl, pageNumber, highlights, onPageCountChange, onSelectionCapture, onStatusChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const [textRuns, setTextRuns] = useState<TextRun[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [documentLoadKey, setDocumentLoadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadDocument() {
      setIsLoading(true);
      try {
        const pdfDocument = (await pdfjsLib.getDocument(fileUrl).promise) as PdfDocument;
        if (cancelled) return;
        if (documentRef.current) await documentRef.current.destroy();
        documentRef.current = pdfDocument;
        onPageCountChange(pdfDocument.numPages);
        setDocumentLoadKey((value) => value + 1);
        onStatusChange(`PDF.js loaded ${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"}.`);
      } catch {
        onStatusChange("PDF.js could not load this PDF.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadDocument();
    return () => { cancelled = true; };
  }, [fileUrl, onPageCountChange, onStatusChange]);

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
        const scale = 1.35;
        const viewport = await renderCanvas(page, canvas, scale);
        const runs = await buildTextRuns(page, scale);
        if (cancelled) return;
        setPageSize({ width: viewport.width, height: viewport.height });
        setTextRuns(runs);
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
    onSelectionCapture({ selectedText, pageNumber, ...contextFor(textRuns, selectedText), rects: rectsFor(range, frame) });
    onStatusChange("Captured selected text and anchor rectangles from the PDF.js text layer.");
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
            <span className="pdfTextRun" data-text-run-index={run.index} key={`${run.index}-${run.text}`} style={{ left: run.left, top: run.top, fontSize: run.fontSize }}>
              {run.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
