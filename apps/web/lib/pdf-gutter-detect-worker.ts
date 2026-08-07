// Renders exactly ONE page, detects its gutter, and - this is the part
// that changed - physically crops the rendered pixels into separate
// left/right images and writes them to disk, rather than relying on
// PDF CropBox to hide the un-wanted half at view time.
//
// That CropBox approach was a real, serious mistake, found only after
// shipping several rounds of detection fixes: pdfjs-dist (used
// throughout this whole investigation to verify output) respects
// CropBox, but poppler's pdftoppm - a hugely common rendering path,
// likely including whatever the actual app uses - does not. Confirmed
// directly: every single "split" page, opened through pdftoppm, showed
// the full original two-page spread, not the intended half. All of the
// detection work in this investigation was real and necessary, but it
// was solving the wrong layer of the problem - the split was only ever
// correct in one specific viewer.
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

const [, , pdfPath, pageArg, outputDir] = process.argv;
const pageIndex = Number(pageArg);
if (!pdfPath || !Number.isInteger(pageIndex) || pageIndex < 1 || !outputDir) {
  console.error("Usage: node pdf-gutter-detect-worker.ts <pdfPath> <pageIndex> <outputDir>");
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
    const gutterX = findGutterSplit(detectionCanvas);

    if (gutterX !== null) {
      const leftCanvas: Canvas = createCanvas(gutterX, height);
      leftCanvas.getContext("2d").drawImage(canvas as unknown as CanvasImageSource, 0, 0, gutterX, height, 0, 0, gutterX, height);
      const rightWidth = width - gutterX;
      const rightCanvas: Canvas = createCanvas(rightWidth, height);
      rightCanvas.getContext("2d").drawImage(canvas as unknown as CanvasImageSource, gutterX, 0, rightWidth, height, 0, 0, rightWidth, height);

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

    console.log(JSON.stringify({ gutterX, widthPixels: width, heightPixels: height }));
  } finally {
    page.cleanup();
  }
} finally {
  if (typeof doc.destroy === "function") await doc.destroy();
}
