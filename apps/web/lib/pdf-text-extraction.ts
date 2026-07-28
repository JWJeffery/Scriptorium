// Server-side PDF text-layer extraction.
//
// Before this existed, PDF ingestion never persisted any extracted text -
// text extraction only ever happened client-side in the reader, for
// display. That meant every PDF's TextSpan set was empty in the database,
// which made the OCR scan-detection heuristic (lib/ocr-provider.ts,
// detectLikelyScanned) read 0 extracted characters for every PDF ever
// registered, real text layer or not. This module reads whatever text
// layer a PDF genuinely has, so that heuristic has something real to
// compare against. It does not render pages or run OCR - see
// lib/tesseract-ocr-provider.ts for that.

import "./pdfjs-worker-setup";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfPageText = { pageIndex: number; text: string };

export type PdfTextExtractionResult = {
  pages: PdfPageText[];
  pageCount: number;
  totalTextLength: number;
};

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export async function extractPdfText(pdfBytes: Buffer): Promise<PdfTextExtractionResult> {
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true
  });

  const doc = await loadingTask.promise;
  const pages: PdfPageText[] = [];
  let totalTextLength = 0;

  try {
    for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex++) {
      const page = await doc.getPage(pageIndex);
      try {
        const content = await page.getTextContent();
        const text = collapseWhitespace(
          content.items.map((item) => ("str" in item ? item.str : "")).join(" ")
        );
        pages.push({ pageIndex, text });
        totalTextLength += text.length;
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }

  return { pages, pageCount: doc.numPages, totalTextLength };
}
