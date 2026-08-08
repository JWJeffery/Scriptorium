// Renders exactly ONE page, detects its gutter, and physically crops the
// rendered pixels into separate left/right images written to disk,
// rather than relying on PDF CropBox to hide the un-wanted half at view
// time.
//
// That CropBox approach was a real, serious mistake, found only after
// shipping several rounds of detection fixes: pdfjs-dist (used
// throughout this whole investigation to verify output) respects
// CropBox, but poppler's pdftoppm - a hugely common rendering path,
// likely including whatever the actual app uses - does not. Confirmed
// directly: every single "split" page, opened through pdftoppm, showed
// the full original two-page spread, not the intended half.
//
// Accepts an optional 5th argument, expectedRatio (0-1, the book's
// typical gutter position as a fraction of page width) - passed through
// to findGutterSplit for pages whose own pixel data is genuinely
// ambiguous (see pdf-page-splitter-shared.ts for the real case that
// motivated this: sparse, widely-spaced footnote text creating a wide
// but only moderately-scoring false candidate that narrowly out-scored
// the true, narrower gutter next to it). The caller runs a first pass
// without this, computes the book's typical position from the
// confidently-detected pages, then re-invokes just the ambiguous ones
// with it.
//
// Run as its own separate OS process, one per page - see
// pdf-page-splitter.ts for why process isolation is required here, not
// optional (found the hard way: rendering many pages sequentially
// within one process silently corrupts pdfjs-dist's output for later
// pages).
import "./pdfjs-worker-setup.ts";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findGutterSplit, RENDER_SCALE, applyContrastEnhancement, CONTRAST_FACTOR } from "./pdf-page-splitter-shared.ts";

const [, , pdfPath, pageArg, outputDir, expectedRatioArg] = process.argv;
const pageIndex = Number(pageArg);
const expectedRatio = expectedRatioArg !== undefined ? Number(expectedRatioArg) : undefined;
if (!pdfPath || !Number.isInteger(pageIndex) || pageIndex < 1 || !outputDir) {
  console.error("Usage: node pdf-gutter-detect-worker.ts <pdfPath> <pageIndex> <outputDir> [expectedRatio]");
  process.exit(1);
}

const bytes = readFileSync(pdfPath);
const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
try {
  const page = await doc.getPage(pageIndex);
  try {
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    // The clean render - this is what actually gets cropped and saved.
    // Contrast enhancement is a detection aid only; baking it into the
    // real output would visibly change how the page looks compared to
    // the original scan, so it's applied to a separate copy instead.
    const canvas: Canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;

    const detectionCanvas: Canvas = createCanvas(width, height);
    detectionCanvas.getContext("2d").drawImage(canvas as unknown as CanvasImageSource, 0, 0);
    applyContrastEnhancement(detectionCanvas, CONTRAST_FACTOR);
    const result = findGutterSplit(detectionCanvas, expectedRatio);

    if (result !== null) {
      const { splitX } = result;
      const leftCanvas: Canvas = createCanvas(splitX, height);
      leftCanvas.getContext("2d").drawImage(canvas as unknown as CanvasImageSource, 0, 0, splitX, height, 0, 0, splitX, height);
      const rightWidth = width - splitX;
      const rightCanvas: Canvas = createCanvas(rightWidth, height);
      rightCanvas.getContext("2d").drawImage(canvas as unknown as CanvasImageSource, splitX, 0, rightWidth, height, 0, 0, rightWidth, height);

      // JPEG, matching the source scan's own encoding (confirmed via
      // pdfimages -list on the real book: 150ppi JPEG). The source is
      // already JPEG-compressed, so re-encoding as JPEG here doesn't
      // introduce a new class of quality loss, and keeps file size sane
      // - a lossless PNG re-encode of a book's worth of page scans would
      // bloat the output far more than the source material justifies.
      const JPEG_QUALITY = 92;
      writeFileSync(join(outputDir, `page-${pageIndex}-left.jpg`), leftCanvas.toBuffer("image/jpeg", JPEG_QUALITY));
      writeFileSync(join(outputDir, `page-${pageIndex}-right.jpg`), rightCanvas.toBuffer("image/jpeg", JPEG_QUALITY));
    }

    console.log(JSON.stringify({
      gutterX: result?.splitX ?? null,
      confidence: result?.confidence ?? null,
      widthPixels: width,
      heightPixels: height
    }));
  } finally {
    page.cleanup();
  }
} finally {
  if (typeof doc.destroy === "function") await doc.destroy();
}
