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

type WorkerResult = { gutterX: number | null; confidence: number | null; widthPixels: number; heightPixels: number };

// TIME LIMITS. One page (render + gutter detection + two JPEG crops, in its own process) takes about a
// second on a laptop. A page process that has not finished after 2 minutes is stuck: it is killed and
// the split fails rather than hanging the queue. The whole split gets 5 minutes plus 30 s a page
// (pass 2 re-runs some pages), e.g. about 3 h 37 min for 425 pages, well inside the queue's expiry.
export const SPLIT_PAGE_TIMEOUT_MS = 2 * 60 * 1000;
export const splitTimeLimitMs = (pageCount: number) => (5 * 60 + 30 * pageCount) * 1000;

export class SplitTimeoutError extends Error {}

export type SplitOptions = {
  // Stops the split (and kills the page process) when aborted, e.g. on worker shutdown.
  signal?: AbortSignal;
  pageTimeoutMs?: number;
  timeLimitMs?: (pageCount: number) => number;
};

async function runWorker(
  workerPath: string,
  tempPdfPath: string,
  pageIndex: number,
  tempDir: string,
  expectedRatio: number | undefined,
  signal: AbortSignal,
  pageTimeoutMs: number
): Promise<WorkerResult> {
  const args = [
    "--experimental-strip-types",
    workerPath,
    tempPdfPath,
    String(pageIndex),
    tempDir,
    ...(expectedRatio !== undefined ? [String(expectedRatio)] : [])
  ];
  signal.throwIfAborted();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(process.execPath, args, {
      maxBuffer: 1024 * 1024 * 50,
      timeout: pageTimeoutMs,
      killSignal: "SIGKILL",
      signal
    }));
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    const killed = (error as { killed?: boolean; signal?: string }).killed;
    if (killed) throw new SplitTimeoutError(`Page splitting stopped: page ${pageIndex} took longer than ${Math.round(pageTimeoutMs / 1000)} seconds.`);
    throw error;
  }
  // The worker may emit warnings on stdout/stderr from pdfjs-dist
  // (missing embedded font glyphs, etc. - harmless, seen throughout this
  // whole investigation); only the last line is the actual JSON result.
  const lastLine = stdout.trim().split("\n").pop() ?? "";
  return JSON.parse(lastLine) as WorkerResult;
}

export async function splitTwoPageSpreadPdf(
  pdfBytes: Buffer | Uint8Array,
  onProgress?: (completed: number, total: number) => void,
  options: SplitOptions = {}
): Promise<SplitPdfResult> {
  const bytes = pdfBytes instanceof Buffer ? new Uint8Array(pdfBytes) : pdfBytes;

  const sourceDoc = await PDFDocument.load(bytes);
  const originalPageCount = sourceDoc.getPageCount();

  const limitMs = (options.timeLimitMs ?? splitTimeLimitMs)(originalPageCount);
  const limit = new AbortController();
  const limitTimer = setTimeout(
    () => limit.abort(new SplitTimeoutError(`Page splitting stopped: it took longer than its ${Math.round(limitMs / 60_000)}-minute limit for ${originalPageCount} pages.`)),
    limitMs
  );
  limitTimer.unref?.();
  const signal = options.signal ? AbortSignal.any([options.signal, limit.signal]) : limit.signal;
  const pageTimeoutMs = options.pageTimeoutMs ?? SPLIT_PAGE_TIMEOUT_MS;
  const run = (pageIndex: number, expectedRatio?: number) =>
    runWorker(workerPath, tempPdfPath, pageIndex, tempDir, expectedRatio, signal, pageTimeoutMs);

  // Each page is rendered, gutter-detected, and - for pages that split -
  // physically cropped into separate left/right JPEGs, all inside a
  // worker run as its own separate OS process (see
  // pdf-gutter-detect-worker.ts for why process isolation is required).
  // The cropped images are written to a shared temp directory and read
  // back here to embed into the output PDF as brand new pages with their
  // own correctly-sized MediaBox, rather than the original CropBox
  // approach (advisory metadata that not all PDF viewers respect -
  // confirmed directly that poppler's pdftoppm ignores it outright).
  const tempDir = await mkdtemp(join(tmpdir(), "scriptorium-split-"));
  const tempPdfPath = join(tempDir, "source.pdf");
  const workerPath = join(__dirname, "pdf-gutter-detect-worker.ts");
  try {
    await writeFile(tempPdfPath, bytes);

    // PASS 1: detect (and, for split pages, crop) every page without any
    // cross-page context. This is right for the overwhelming majority of
    // pages - a genuine gutter usually scores unambiguously higher than
    // anything else on the same page. It's not always enough on its own,
    // though: found a real page where sparse, widely-spaced footnote
    // text created a wide but only moderately-scoring false candidate
    // that beat the true, narrower gutter next to it by a razor-thin
    // margin, because a single page's own pixel data has no way to
    // settle a tie that close. Confirmed directly against that page:
    // cropping at the wrong candidate split real footnote text across
    // both halves.
    //
    // Progress is reported against pass 1 only (0..originalPageCount) -
    // pass 2 only touches the rare ambiguous page and pass 1 is where
    // nearly all of the wall-clock time goes (one full render per page,
    // in its own process), so a progress bar driven by pass 1 alone
    // tracks the real work closely enough without needing to know pass
    // 2's page count in advance.
    const results: WorkerResult[] = [];
    for (let pageIndex = 1; pageIndex <= originalPageCount; pageIndex++) {
      results.push(await run(pageIndex));
      onProgress?.(pageIndex, originalPageCount);
    }

    // A real book's binding sits at a physically consistent position
    // from page to page, so the fix is cross-page: compute the book's
    // typical gutter position from the pages that WERE detected with
    // high confidence, then re-run just the ambiguous ones (low
    // confidence, i.e. the top candidate wasn't a clear winner) with
    // that expected position as a tiebreaker. High-confidence pages are
    // left exactly as pass 1 found them - this only touches pages pass 1
    // was already unsure about.
    const HIGH_CONFIDENCE_THRESHOLD = 0.85;
    const confidentRatios: number[] = [];
    for (const r of results) {
      if (r.gutterX !== null && r.confidence !== null && r.confidence >= HIGH_CONFIDENCE_THRESHOLD && r.widthPixels) {
        confidentRatios.push(r.gutterX / r.widthPixels);
      }
    }
    let expectedRatio: number | undefined;
    if (confidentRatios.length > 0) {
      const sorted = [...confidentRatios].sort((a, b) => a - b);
      expectedRatio = sorted[Math.floor(sorted.length / 2)];
    }

    if (expectedRatio !== undefined) {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const pageIndex = i + 1;
        const isAmbiguous = r.gutterX !== null && r.confidence !== null && r.confidence < HIGH_CONFIDENCE_THRESHOLD;
        if (isAmbiguous) {
          results[i] = await run(pageIndex, expectedRatio);
        }
      }
    }

    // Build the output PDF from the (possibly pass-2-corrected) results.
    const outputDoc = await PDFDocument.create();
    const splitOriginalPageNumbers: number[] = [];

    for (let pageIndex = 1; pageIndex <= originalPageCount; pageIndex++) {
      const { gutterX } = results[pageIndex - 1];
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
      // file has used since the CropBox version - only what happens with
      // the number changed, not the math itself.
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
    clearTimeout(limitTimer);
    await rm(tempDir, { recursive: true, force: true });
  }
}
