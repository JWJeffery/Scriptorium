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
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RENDER_SCALE } from "./pdf-page-splitter-shared.ts";

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

  // Each page is rendered, gutter-detected, and - for pages that split -
  // physically cropped into separate left/right JPEGs, all inside a
  // worker run as its own separate OS process (see
  // pdf-gutter-detect-worker.ts for why process isolation is required).
  // The cropped images are written to a shared temp directory and read
  // back here to embed into the output PDF as brand new pages with their
  // own correctly-sized MediaBox.
  //
  // This - actually cropping pixels, not just setting each page's
  // CropBox and leaving the underlying image untouched - is not the
  // original design. The CropBox approach was shipped, extensively
  // tested, and wrong in a way that only showed up outside the one
  // viewer (pdfjs-dist) used to verify it throughout this whole
  // investigation: CropBox is advisory, and poppler's pdftoppm - a very
  // common rendering path - ignores it outright, showing the full
  // original two-page spread for every single "split" page. Confirmed
  // directly against the real output file before rewriting this.
  const tempDir = await mkdtemp(join(tmpdir(), "scriptorium-split-"));
  const tempPdfPath = join(tempDir, "source.pdf");
  const workerPath = join(__dirname, "pdf-gutter-detect-worker.ts");
  const gutterResults: { gutterX: number | null }[] = [];
  try {
    await writeFile(tempPdfPath, bytes);
    for (let pageIndex = 1; pageIndex <= originalPageCount; pageIndex++) {
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--experimental-strip-types", workerPath, tempPdfPath, String(pageIndex), tempDir],
        { maxBuffer: 1024 * 1024 * 50 }
      );
      // The worker may emit warnings on stdout/stderr from pdfjs-dist
      // (missing embedded font glyphs, etc. - harmless, seen throughout
      // this whole investigation); only the last line is the actual
      // JSON result this process cares about.
      const lastLine = stdout.trim().split("\n").pop() ?? "";
      const result = JSON.parse(lastLine) as { gutterX: number | null };
      gutterResults.push(result);
    }

    // Build the output PDF from the cropped images (or, for pages with
    // no detected gutter, a straight copy of the original page - no
    // cropping involved there, so the existing CropBox-free copyPages
    // approach is already fully correct for those).
    const outputDoc = await PDFDocument.create();
    const splitOriginalPageNumbers: number[] = [];

    for (let pageIndex = 1; pageIndex <= originalPageCount; pageIndex++) {
      const { gutterX } = gutterResults[pageIndex - 1];
      const sourcePageIndex = pageIndex - 1; // pdf-lib is 0-indexed

      if (gutterX === null) {
        const [copy] = await outputDoc.copyPages(sourceDoc, [sourcePageIndex]);
        outputDoc.addPage(copy);
        continue;
      }

      splitOriginalPageNumbers.push(pageIndex);
      const leftBytes = await readFile(join(tempDir, `page-${pageIndex}-left.jpg`));
      const rightBytes = await readFile(join(tempDir, `page-${pageIndex}-right.jpg`));
      const leftImage = await outputDoc.embedJpg(leftBytes);
      const rightImage = await outputDoc.embedJpg(rightBytes);

      // Pixel dimensions back to PDF point space, same conversion this
      // file has used since the CropBox version - only what happens
      // with the number changed, not the math itself.
      const leftWidthPoints = leftImage.width / RENDER_SCALE;
      const leftHeightPoints = leftImage.height / RENDER_SCALE;
      const rightWidthPoints = rightImage.width / RENDER_SCALE;
      const rightHeightPoints = rightImage.height / RENDER_SCALE;

      const leftPage = outputDoc.addPage([leftWidthPoints, leftHeightPoints]);
      leftPage.drawImage(leftImage, { x: 0, y: 0, width: leftWidthPoints, height: leftHeightPoints });

      const rightPage = outputDoc.addPage([rightWidthPoints, rightHeightPoints]);
      rightPage.drawImage(rightImage, { x: 0, y: 0, width: rightWidthPoints, height: rightHeightPoints });
    }

    const outputBytes = await outputDoc.save();
    return {
      pdfBytes: outputBytes,
      originalPageCount,
      newPageCount: outputDoc.getPageCount(),
      splitOriginalPageNumbers
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
