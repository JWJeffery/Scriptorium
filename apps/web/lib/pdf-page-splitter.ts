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
import { PDFDocument } from "pdf-lib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

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

  const sourceDoc = await PDFDocument.load(bytes);
  const originalPageCount = sourceDoc.getPageCount();

  // Detection runs one page at a time, each in its OWN separate OS
  // process (see pdf-gutter-detect-worker.ts for the full story) - this
  // is real, confirmed-necessary overhead, not an arbitrary design
  // choice: rendering many pages sequentially within one process was
  // silently corrupting the rendered pixel data for later pages, and
  // every same-process fix attempted (fresh document instances, keeping
  // pdf-lib's work fully separate from pdfjs's rendering, forcing
  // garbage collection between pages) failed to resolve it - only full
  // process isolation, tested directly against the real page that
  // exposed the bug, gave correct results consistently. A temp file is
  // used to hand the PDF bytes to each worker process rather than
  // passing them as a command-line argument, which has practical size
  // limits a real book-length PDF can exceed.
  const tempDir = await mkdtemp(join(tmpdir(), "scriptorium-split-"));
  const tempPdfPath = join(tempDir, "source.pdf");
  const workerPath = join(__dirname, "pdf-gutter-detect-worker.ts");
  const gutterPositions: (number | null)[] = [];
  try {
    await writeFile(tempPdfPath, bytes);
    for (let pageIndex = 1; pageIndex <= originalPageCount; pageIndex++) {
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--experimental-strip-types", workerPath, tempPdfPath, String(pageIndex)],
        { maxBuffer: 1024 * 1024 * 50 }
      );
      // The worker may emit warnings on stdout/stderr from pdfjs-dist
      // (missing embedded font glyphs, etc. - harmless, seen throughout
      // this whole investigation); only the last line is the actual
      // JSON result this process cares about.
      const lastLine = stdout.trim().split("\n").pop() ?? "";
      const { gutterX } = JSON.parse(lastLine) as { gutterX: number | null };
      gutterPositions.push(gutterX);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  // Build the output PDF from the already-computed gutter positions -
  // pure pdf-lib work, no pdfjs rendering happening alongside it (kept
  // separate from detection as a matter of course now, not just because
  // it was one of the things tried above).
  const outputDoc = await PDFDocument.create();
  const splitOriginalPageNumbers: number[] = [];

  for (let pageIndex = 1; pageIndex <= originalPageCount; pageIndex++) {
    const gutterX = gutterPositions[pageIndex - 1];
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
    const RENDER_SCALE = 2; // must match pdf-page-splitter-shared.ts
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
  }

  const outputBytes = await outputDoc.save();
  return {
    pdfBytes: outputBytes,
    originalPageCount,
    newPageCount: outputDoc.getPageCount(),
    splitOriginalPageNumbers
  };
}
