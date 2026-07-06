"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type TextRun = {
  id: string;
  text: string;
  left: number;
  top: number;
  fontSize: number;
};

type PdfPageReaderProps = {
  fileUrl: string;
  pageNumber: number;
  onPageCountChange: (pageCount: number) => void;
  onSelectionCapture: (selectedText: string) => void;
  onStatusChange: (status: string) => void;
};

function isTextItem(item: unknown): item is TextItem {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

async function renderCanvas(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvasContext = canvas.getContext("2d");

  if (!canvasContext) {
    throw new Error("Could not open PDF canvas context.");
  }

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  await page.render({ canvasContext, viewport }).promise;

  return viewport;
}

async function buildTextRuns(page: PDFPageProxy, scale: number) {
  const viewport = page.getViewport({ scale });
  const textContent = await page.getTextContent();

  return textContent.items.filter(isTextItem).map((item, index) => {
    const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.max(Math.hypot(transform[2], transform[3]), 8);
    const left = transform[4];
    const top = viewport.height - transform[5] - fontSize;

    return {
      id: `${index}-${item.str.slice(0, 12)}`,
      text: item.str,
      left,
      top,
      fontSize
    } satisfies TextRun;
  });
}

export function PdfPageReader({
  fileUrl,
  pageNumber,
  onPageCountChange,
  onSelectionCapture,
  onStatusChange
}: PdfPageReaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const [textRuns, setTextRuns] = useState<TextRun[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadDocument() {
      setIsLoading(true);
      try {
        const loadingTask = pdfjsLib.getDocument(fileUrl);
        const pdfDocument = await loadingTask.promise;

        if (isCancelled) {
          await pdfDocument.destroy();
          return;
        }

        if (documentRef.current) {
          await documentRef.current.destroy();
        }

        documentRef.current = pdfDocument;
        onPageCountChange(pdfDocument.numPages);
        onStatusChange(`PDF.js loaded ${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"}.`);
      } catch {
        onStatusChange("PDF.js could not load this PDF.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadDocument();

    return () => {
      isCancelled = true;
    };
  }, [fileUrl, onPageCountChange, onStatusChange]);

  useEffect(() => {
    let isCancelled = false;

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

        if (isCancelled) return;

        setPageSize({ width: viewport.width, height: viewport.height });
        setTextRuns(runs);
        onStatusChange(`Rendered PDF page ${safePageNumber} with selectable text layer.`);
      } catch {
        if (!isCancelled) onStatusChange("Could not render this PDF page.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    renderPage();

    return () => {
      isCancelled = true;
    };
  }, [pageNumber, onStatusChange]);

  function captureSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\s+/g, " ").trim();

    if (!selectedText) return;

    onSelectionCapture(selectedText);
    onStatusChange("Captured selected text from the PDF.js text layer.");
  }

  return (
    <div className="pdfReaderShell">
      {isLoading ? <div className="pdfLoading">Rendering PDF page…</div> : null}
      <div
        className="pdfPageFrame"
        onMouseUp={captureSelection}
        style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}
      >
        <canvas ref={canvasRef} className="pdfCanvas" />
        <div className="pdfTextLayer" aria-label="Selectable PDF text layer">
          {textRuns.map((run) => (
            <span
              className="pdfTextRun"
              key={run.id}
              style={{ left: run.left, top: run.top, fontSize: run.fontSize }}
            >
              {run.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
