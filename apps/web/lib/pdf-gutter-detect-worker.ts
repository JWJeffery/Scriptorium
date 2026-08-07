// Renders and gutter-detects exactly ONE page, run as its own separate OS
// process (spawned by pdf-page-splitter.ts, one process per page) rather
// than as a function call within a shared process.
//
// This is not a stylistic choice - it's a confirmed requirement. Found via
// extensive, rigorous testing against the real book: rendering many pages
// sequentially within one process causes @napi-rs/canvas (a native addon)
// or pdfjs-dist's own native/WASM bindings to silently degrade the
// rendered pixel data for later pages, with no error or warning. Ruled
// out, in order, as the actual cause: reusing one shared pdfjs document
// instance across pages, interleaving pdf-lib work with pdfjs rendering,
// and GC/memory pressure (forcing garbage collection between every page
// made no difference). What DID make a difference, tested directly
// against the real page that exposed the bug: running that page's
// detection in a completely separate `node` process gave the correct
// result every time, while every same-process approach - regardless of
// document/canvas management - gave the same wrong answer. Full OS-level
// process isolation is the only fix that's actually been confirmed to
// work.
import "./pdfjs-worker-setup.ts";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";
import { findGutterSplit, RENDER_SCALE, applyContrastEnhancement, CONTRAST_FACTOR } from "./pdf-page-splitter-shared.ts";

const [, , pdfPath, pageArg] = process.argv;
const pageIndex = Number(pageArg);
if (!pdfPath || !Number.isInteger(pageIndex) || pageIndex < 1) {
  console.error("Usage: node pdf-gutter-detect-worker.ts <pdfPath> <pageIndex>");
  process.exit(1);
}

const bytes = readFileSync(pdfPath);
const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
try {
  const page = await doc.getPage(pageIndex);
  try {
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas: Canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
    applyContrastEnhancement(canvas, CONTRAST_FACTOR);
    const gutterX = findGutterSplit(canvas);
    // Single line of JSON on stdout - the only output this process
    // produces, so the parent process's parsing stays simple.
    console.log(JSON.stringify({ gutterX }));
  } finally {
    page.cleanup();
  }
} finally {
  if (typeof doc.destroy === "function") await doc.destroy();
}
