// Physically restructures a PDF whose pages are two-page spreads (scanned
// as one image per real book-page-pair, the layout this whole codebase's
// OCR investigation has been dealing with - see RESUME_PROJECT_NOTE.md)
// into a PDF with one real page per book page - e.g. 64 spread-pages
// becoming 128 individual pages.
//
// This is a genuinely different, bigger kind of fix than the gutter-split
// already added to tesseract-ocr-provider.ts. That one only changes what
// happens *internally* during OCR - it still leaves the underlying PDF
// itself as 64 two-page-spread pages, and the reader still shows each one
// as a single spread. This module actually rewrites the PDF file: each
// spread page becomes two real, separate, individually-navigable pages.
//
// Deliberately NOT wired into the existing OCR pipeline or the app's
// upload/document flow yet - this is a standalone conversion tool (see
// scripts/split-two-page-spreads.mjs) that produces a new PDF file for
// the person to review and re-upload through the app's existing upload
// flow, rather than silently restructuring an existing document's pages
// out from under any page-map settings or annotations already saved
// against the current page numbering. A person's own explicit "yes,
// re-upload this as the working copy" step matters here.
import "./pdfjs-worker-setup.ts";
import { PDFDocument } from "pdf-lib";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Same rendering scale as the OCR pipeline (tesseract-ocr-provider.ts) -
// doesn't need to match exactly for correctness (the split coordinate
// gets converted back to PDF point space either way), but keeping it
// consistent means gutter-detection behavior is identical to what's
// already been verified against the real book.
const RENDER_SCALE = 2;
const GUTTER_SEARCH_BAND = [0.3, 0.7] as const;
const GUTTER_MIN_BLANK_FRACTION = 0.9;
// A candidate gutter also needs real content on BOTH sides of it - a
// sparse single-column page with a short paragraph and a large blank
// margin can otherwise look exactly like a two-column gutter (the blank
// margin passes the "blank across nearly full height" test just as well
// as a real gutter does). Caught this directly: a synthetic single-column
// test page produced a false-positive split with 0.0000 ink density on
// one side - genuine two-page spreads have substantial content on both
// halves, so this threshold is set low enough to accept real but sparse
// pages while rejecting "no content at all over here" splits.
const GUTTER_MIN_INK_FRACTION_PER_SIDE = 0.001;

function findGutterSplit(canvas: Canvas): number | null {
  // Deliberately a separate implementation from tesseract-ocr-provider.ts's
  // own gutter detection rather than importing it - keeps the
  // already-verified, working OCR path completely untouched by this new
  // tool. This version is also stricter (see GUTTER_MIN_INK_FRACTION_PER_SIDE
  // below, added after catching a real false-positive here) - the OCR
  // provider's copy doesn't have that same safeguard yet and could
  // theoretically hit the same false-positive on a sufficiently sparse
  // page, worth backporting there too if it ever comes up in practice.
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const brightnessAt = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  };
  const bandStart = Math.floor(width * GUTTER_SEARCH_BAND[0]);
  const bandEnd = Math.ceil(width * GUTTER_SEARCH_BAND[1]);
  let bestX = -1;
  let bestFraction = 0;
  for (let x = bandStart; x < bandEnd; x++) {
    let blankCount = 0;
    for (let y = 0; y < height; y++) {
      if (brightnessAt(x, y) > 200) blankCount++;
    }
    const fraction = blankCount / height;
    if (fraction > bestFraction) {
      bestFraction = fraction;
      bestX = x;
    }
  }
  if (bestFraction < GUTTER_MIN_BLANK_FRACTION || bestX < 0) return null;

  // Confirm real content on both sides, sampling every few pixels rather
  // than every single one (this only runs once, on the winning candidate,
  // so the cost is negligible either way, but there's no need for
  // per-pixel precision on a whole-page ink-density check).
  const SAMPLE_STEP = 4;
  let leftInk = 0;
  let leftTotal = 0;
  let rightInk = 0;
  let rightTotal = 0;
  for (let y = 0; y < height; y += SAMPLE_STEP) {
    for (let x = 0; x < bestX; x += SAMPLE_STEP) {
      leftTotal++;
      if (brightnessAt(x, y) <= 200) leftInk++;
    }
    for (let x = bestX; x < width; x += SAMPLE_STEP) {
      rightTotal++;
      if (brightnessAt(x, y) <= 200) rightInk++;
    }
  }
  const leftInkFraction = leftTotal > 0 ? leftInk / leftTotal : 0;
  const rightInkFraction = rightTotal > 0 ? rightInk / rightTotal : 0;
  if (leftInkFraction < GUTTER_MIN_INK_FRACTION_PER_SIDE || rightInkFraction < GUTTER_MIN_INK_FRACTION_PER_SIDE) {
    return null;
  }

  return bestX;
}

export type SplitPdfResult = {
  pdfBytes: Uint8Array;
  originalPageCount: number;
  newPageCount: number;
  // 1-indexed original page numbers that were actually split - lets the
  // caller report "62 of 64 pages were two-page spreads and got split;
  // pages 1 and 64 looked like single pages and were kept as-is" rather
  // than a silent, unexplained page-count change.
  splitOriginalPageNumbers: number[];
};

export async function splitTwoPageSpreadPdf(pdfBytes: Buffer | Uint8Array): Promise<SplitPdfResult> {
  const bytes = pdfBytes instanceof Buffer ? new Uint8Array(pdfBytes) : pdfBytes;

  // pdfjs-dist is used only to RENDER each page so the gutter-detection
  // logic (which needs actual pixel data) can find the split point -
  // pdf-lib has no rendering capability of its own. pdf-lib is used to
  // actually build the new, restructured PDF, since pdfjs-dist has no
  // PDF-writing capability.
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true });
  const renderDoc = await loadingTask.promise;
  const sourceDoc = await PDFDocument.load(bytes);
  const outputDoc = await PDFDocument.create();

  const originalPageCount = renderDoc.numPages;
  const splitOriginalPageNumbers: number[] = [];

  for (let pageIndex = 1; pageIndex <= originalPageCount; pageIndex++) {
    const page = await renderDoc.getPage(pageIndex);
    try {
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
      const gutterX = findGutterSplit(canvas);

      const sourcePageIndex = pageIndex - 1; // pdf-lib is 0-indexed
      if (gutterX === null) {
        // No real gutter found - looks like a genuine single page, not a
        // two-page spread. Copy it through unchanged rather than forcing
        // a split that isn't there.
        const [copy] = await outputDoc.copyPages(sourceDoc, [sourcePageIndex]);
        outputDoc.addPage(copy);
        continue;
      }

      splitOriginalPageNumbers.push(pageIndex);
      const splitXPoints = gutterX / RENDER_SCALE;
      const [leftCopy] = await outputDoc.copyPages(sourceDoc, [sourcePageIndex]);
      const [rightCopy] = await outputDoc.copyPages(sourceDoc, [sourcePageIndex]);
      const { width: pageWidthPoints, height: pageHeightPoints } = leftCopy.getSize();

      // CropBox only changes what's *visible* - the underlying page
      // content (the scanned image, embedded once) is untouched, so this
      // doesn't re-rasterize or duplicate any image data. Every
      // compliant PDF viewer (Preview, Acrobat, this app's own pdf.js
      // reader) respects CropBox as the page's real visible boundary.
      leftCopy.setCropBox(0, 0, splitXPoints, pageHeightPoints);
      rightCopy.setCropBox(splitXPoints, 0, pageWidthPoints - splitXPoints, pageHeightPoints);

      outputDoc.addPage(leftCopy);
      outputDoc.addPage(rightCopy);
    } finally {
      page.cleanup();
    }
  }

  if (typeof renderDoc.destroy === "function") await renderDoc.destroy();

  const outputBytes = await outputDoc.save();
  return {
    pdfBytes: outputBytes,
    originalPageCount,
    newPageCount: outputDoc.getPageCount(),
    splitOriginalPageNumbers
  };
}
