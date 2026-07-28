// Real OCR provider, English only. Renders each PDF page to a PNG via
// pdfjs-dist + @napi-rs/canvas (no system Cairo/Poppler dependency - both
// packages ship prebuilt, portable binaries), then runs Tesseract over each
// page image. This is the concrete implementation the OcrProvider contract
// in ocr-provider.ts was deliberately built to accept later.
//
// Scope: English/Latin script only, matching what this corpus needs today.
// Adding another language later means adding another lang code to
// createWorker and, for non-Latin scripts, checking Tesseract's accuracy on
// the specific script before trusting it the way the Unicode-aware search
// fix (gate 18) already trusts Greek/Ge'ez/Syriac/Coptic text.

import "./pdfjs-worker-setup";
import { createWorker } from "tesseract.js";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OcrProvider, OcrResult } from "./ocr-provider";

// Higher scale = sharper rendered page = better recognition, at the cost of
// time and memory. 2x is a reasonable middle ground for a scanned book page.
const RENDER_SCALE = 2;
const LOW_CONFIDENCE_THRESHOLD = 40;

export class TesseractOcrProvider implements OcrProvider {
  readonly name = "tesseract-js-eng-v1";

  async extractText(input: { pdfBytes: Buffer; documentId: string }): Promise<OcrResult> {
    const loadingTask = getDocument({
      data: new Uint8Array(input.pdfBytes),
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true
    });
    const doc = await loadingTask.promise;
    const worker = await createWorker("eng");
    const pages: { pageIndex: number; text: string; confidence: number }[] = [];
    const warnings: string[] = [];

    try {
      for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex++) {
        const page = await doc.getPage(pageIndex);
        try {
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext("2d");

          // pdfjs's render() expects a DOM-shaped CanvasRenderingContext2D.
          // @napi-rs/canvas implements the subset pdfjs actually calls, but
          // TypeScript doesn't know that, hence the cast.
          await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;

          const pngBuffer = canvas.toBuffer("image/png");
          const { data } = await worker.recognize(pngBuffer);
          const text = data.text.trim();
          pages.push({ pageIndex, text, confidence: data.confidence });

          if (text && data.confidence < LOW_CONFIDENCE_THRESHOLD) {
            warnings.push(
              `Page ${pageIndex}: low OCR confidence (${data.confidence.toFixed(0)}%) - recognized text may be unreliable and worth checking against the original scan.`
            );
          }
        } finally {
          page.cleanup();
        }
      }
    } finally {
      await worker.terminate();
      await doc.destroy();
    }

    return {
      text: pages.map((page) => page.text).join("\n\n"),
      warnings,
      pages
    };
  }
}

export const tesseractOcrProvider = new TesseractOcrProvider();
