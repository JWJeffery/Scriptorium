import type { ProcessingJob } from "@prisma/client";
import { prisma } from "../prisma.ts";
import { readStoredPdfFile, storePdfFile } from "../server-storage.ts";
import { ocrPageWarnings, tesseractOcrProvider } from "../tesseract-ocr-provider.ts";
import type { OcrPage } from "../ocr-provider.ts";
import { splitTwoPageSpreadPdf, SplitTimeoutError } from "../pdf-page-splitter.ts";
import { ensureModel } from "../embeddings.ts";
import { indexDocument } from "../meaning-index.ts";
import { JobInterruptedError, PermanentJobError, reportProgress } from "./jobs.ts";
import { OCR_FAILED_STATE, OCR_NO_TEXT_STATE, OCR_RUNNING_STATE, OCR_TIMEOUT_STATE } from "./ocr-states.ts";

// What each kind of long job actually does. They run in the worker (or, in inline mode, the web server)
// and report progress through the durable job record, never through memory shared with a request.

export { OCR_FAILED_STATE, OCR_NO_TEXT_STATE, OCR_RUNNING_STATE, OCR_TIMEOUT_STATE };

// OCR TIME LIMIT, scaled to the work. It exists so a hung language-data download or a stalled
// recognition cannot leave a book "running" for ever; it must never stop a real book. History: a flat
// 12 minutes was enough for the 64-page test scan (which took a little over 3 minutes, about 3 s a page)
// but not for a real 425-page book, and two-page spreads are recognized as two halves (twice the work).
//   base      5 minutes: start-up, the first-run language-data download, opening a 40 MB PDF.
//   per page  20 seconds: about 6x the measured 3 s a page, to cover spreads (x2) on a small, busy,
//             swapping server (x3).
// A 425-page book gets 5 + 425 x 20 s = about 2 h 27 min; a resumed run counts only the pages it still
// has to do. Capped at 10 hours, below the queue's 12-hour expiry (lib/jobs/queue.ts). Both numbers can
// be overridden (in seconds) with SCRIPTORIUM_OCR_BASE_SECONDS and SCRIPTORIUM_OCR_SECONDS_PER_PAGE.
const positiveFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const OCR_BASE_SECONDS = positiveFromEnv("SCRIPTORIUM_OCR_BASE_SECONDS", 5 * 60);
const OCR_SECONDS_PER_PAGE = positiveFromEnv("SCRIPTORIUM_OCR_SECONDS_PER_PAGE", 20);
const OCR_MAX_SECONDS = 10 * 3600;
export function ocrTimeLimitMs(pagesToDo: number) {
  return Math.min(OCR_MAX_SECONDS, OCR_BASE_SECONDS + OCR_SECONDS_PER_PAGE * pagesToDo) * 1000;
}

// OCR results are saved every this many pages, so a crash, a deploy or a time-out loses at most this
// much work, and the next run starts at the first page not yet saved.
const OCR_BATCH_PAGES = Math.round(positiveFromEnv("SCRIPTORIUM_OCR_BATCH_PAGES", 10));

export const SPLIT_OUTPUT_FILENAME = "split-two-page-spreads.pdf";

export type JobContext = { signal?: AbortSignal };

export async function runJob(job: ProcessingJob, context: JobContext = {}): Promise<unknown> {
  switch (job.type) {
    case "ocr":
      return runOcr(job, context);
    case "page-split":
      return runPageSplit(job, context);
    case "embed-index":
      return runEmbedIndex(job);
    default:
      throw new PermanentJobError(`Unknown job type: ${job.type}`);
  }
}

class OcrTimeLimitError extends Error {}

// HOW OCR PROGRESS IS STORED. Each finished page is saved as the version's TextSpan for that page, in its
// final shape ({ pdfPageIndex, ocr: true, confidence, words }) plus `ocrPending: true`, replacing whatever
// span that page had. The reader and search can use those pages at once. When every page is done,
// finishOcr rewrites the version's spans exactly as an uninterrupted run always has: one span per page,
// in page order, without the marker, the run's warnings on the first. A run that finds pending pages
// (from an interrupted or timed-out run on this version) skips them.
async function savedOcrPages(versionId: string) {
  const rows = await prisma.$queryRaw<{ page: number }[]>`
    SELECT DISTINCT (anchor->>'pdfPageIndex')::int AS page FROM "TextSpan"
    WHERE "versionId" = ${versionId} AND anchor->>'ocrPending' = 'true'`;
  return new Set(rows.map((row) => Number(row.page)));
}

async function saveOcrBatch(versionId: string, pages: OcrPage[]) {
  await prisma.$transaction([
    prisma.textSpan.deleteMany({ where: { versionId, OR: pages.map((page) => ({ anchor: { path: ["pdfPageIndex"], equals: page.pageIndex } })) } }),
    prisma.textSpan.createMany({
      data: pages.map((page) => ({
        versionId,
        text: page.text,
        anchor: { pdfPageIndex: page.pageIndex, ocr: true, confidence: page.confidence, words: page.words, ocrPending: true }
      }))
    })
  ]);
}

type StoredOcrAnchor = { pdfPageIndex: number; ocr: true; confidence: number; words?: unknown; ocrPending?: boolean };

async function finishOcr(versionId: string, pageCount: number) {
  // Small summary rows (no word positions) for the warnings and the completeness check.
  const summaries = await prisma.$queryRaw<{ id: string; page: number; text: string; confidence: number; wordCount: number }[]>`
    SELECT id, (anchor->>'pdfPageIndex')::int AS page, text, (anchor->>'confidence')::float8 AS confidence,
           COALESCE(jsonb_array_length(anchor->'words'), 0)::int AS "wordCount"
    FROM "TextSpan" WHERE "versionId" = ${versionId} AND anchor->>'ocrPending' = 'true'
    ORDER BY page, "createdAt" DESC`;
  const byPage = new Map<number, (typeof summaries)[number]>();
  for (const row of summaries) if (!byPage.has(Number(row.page))) byPage.set(Number(row.page), row);
  const missing: number[] = [];
  for (let page = 1; page <= pageCount; page++) if (!byPage.has(page)) missing.push(page);
  if (missing.length > 0) throw new Error(`OCR finished, but no text was saved for page(s) ${missing.slice(0, 10).join(", ")}.`);
  const ordered = Array.from({ length: pageCount }, (_, i) => byPage.get(i + 1)!);
  const warnings = ordered.flatMap((row) =>
    ocrPageWarnings({ pageIndex: Number(row.page), text: row.text, confidence: Number(row.confidence), wordCount: Number(row.wordCount) })
  );

  // Rebuilt a few pages at a time (a long book's word positions are large), all in one transaction.
  const CHUNK = 25;
  await prisma.$transaction(
    async (tx) => {
      const oldIds = (await tx.textSpan.findMany({ where: { versionId }, select: { id: true } })).map((row) => row.id);
      for (let start = 0; start < ordered.length; start += CHUNK) {
        const chunk = ordered.slice(start, start + CHUNK);
        const rows = await tx.textSpan.findMany({ where: { id: { in: chunk.map((row) => row.id) } }, select: { id: true, text: true, anchor: true } });
        const byId = new Map(rows.map((row) => [row.id, row]));
        await tx.textSpan.createMany({
          data: chunk.map((summary, offset) => {
            const row = byId.get(summary.id)!;
            const anchor = row.anchor as StoredOcrAnchor;
            const index = start + offset;
            return {
              versionId,
              text: row.text,
              anchor: {
                pdfPageIndex: anchor.pdfPageIndex,
                ocr: true,
                confidence: anchor.confidence,
                words: anchor.words as object,
                ...(index === 0 && warnings.length > 0 ? { ocrWarnings: warnings } : {})
              }
            };
          })
        });
      }
      for (let start = 0; start < oldIds.length; start += 1000) {
        await tx.textSpan.deleteMany({ where: { id: { in: oldIds.slice(start, start + 1000) } } });
      }
      await tx.documentVersion.update({ where: { id: versionId }, data: { extractionState: tesseractOcrProvider.name } });
    },
    { maxWait: 30_000, timeout: 10 * 60_000 }
  );
}

async function runOcr(job: ProcessingJob, { signal }: JobContext) {
  const versionId = job.subjectId;
  const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
  if (!version?.snapshotKey) throw new PermanentJobError("No server-stored PDF file is available for this version.");
  await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: OCR_RUNNING_STATE } });

  const startedAt = Date.now();
  const limit = new AbortController();
  let limitMs = OCR_BASE_SECONDS * 1000; // until the page count is known
  let timer = setTimeout(() => limit.abort(new OcrTimeLimitError("OCR timed out")), limitMs);
  const runSignal = signal ? AbortSignal.any([signal, limit.signal]) : limit.signal;

  const saved = await savedOcrPages(versionId);
  let pageCount = 0;
  let savedCount = saved.size;
  let lastPageDone = 0;
  const unsaved: OcrPage[] = [];
  const flush = async () => {
    if (unsaved.length === 0) return;
    const batch = unsaved.splice(0, unsaved.length);
    await saveOcrBatch(versionId, batch);
    savedCount += batch.length;
    await reportProgress(job.id, lastPageDone, pageCount, true);
  };

  try {
    if (saved.size > 0) console.log(`[ocr] ${versionId}: ${saved.size} page(s) were saved by an earlier run; those are not read again.`);
    const pdfBytes = await readStoredPdfFile(version.snapshotKey);
    const result = await tesseractOcrProvider.extractText(
      { pdfBytes, documentId: versionId },
      (completed, total) => {
        lastPageDone = completed;
        void reportProgress(job.id, completed, total);
      },
      {
        signal: runSignal,
        skipPages: saved,
        onStart: ({ pageCount: total, pagesToDo }) => {
          pageCount = total;
          if (pagesToDo < total) console.log(`[ocr] ${versionId}: continuing with ${pagesToDo} of ${total} pages still to read.`);
          // Re-arm the limit for the whole run, counted from the start.
          clearTimeout(timer);
          limitMs = ocrTimeLimitMs(pagesToDo);
          timer = setTimeout(() => limit.abort(new OcrTimeLimitError("OCR timed out")), Math.max(0, startedAt + limitMs - Date.now()));
        },
        onPageResult: async (page) => {
          unsaved.push(page);
          if (unsaved.length >= OCR_BATCH_PAGES) await flush();
        }
      }
    );
    await flush();
    pageCount = result.pageCount ?? pageCount;
    if (pageCount > 0) {
      await finishOcr(versionId, pageCount);
      return { pages: pageCount };
    }
    await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: OCR_NO_TEXT_STATE } });
    return { pages: 0 };
  } catch (error) {
    // Whatever stopped the run (time limit, shutdown, an error on a later page), keep the pages already done.
    await flush().catch((saveError) => console.error(`[ocr] ${versionId}: could not save the last pages:`, saveError));
    if (signal?.aborted) {
      // A shutdown: the book stays "running", because the job continues after the restart.
      if (signal.reason instanceof JobInterruptedError) throw signal.reason;
      // The queue gave up on this attempt (expired, or its claim was lost); a retry sets "running" again.
      await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: OCR_FAILED_STATE } }).catch(() => undefined);
      throw signal.reason ?? error;
    }
    const timedOut = limit.signal.aborted;
    await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: timedOut ? OCR_TIMEOUT_STATE : OCR_FAILED_STATE } }).catch(() => undefined);
    if (timedOut) {
      const minutes = Math.round(limitMs / 60_000);
      const next = savedCount < pageCount ? ` ${savedCount} of ${pageCount} pages are saved; Retry continues from there.` : "";
      throw new PermanentJobError(`OCR timed out (time limit ${minutes} minutes).${next}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export type SplitResultRecord = {
  resultStorageKey: string;
  originalPageCount: number;
  newPageCount: number;
  splitOriginalPageNumbers: number[];
};

async function runPageSplit(job: ProcessingJob, { signal }: JobContext): Promise<SplitResultRecord> {
  const version = await prisma.documentVersion.findUnique({ where: { id: job.subjectId } });
  if (!version?.snapshotKey) throw new PermanentJobError("No server-stored PDF file is available for this version.");
  const pdfBytes = await readStoredPdfFile(version.snapshotKey);
  let result;
  try {
    result = await splitTwoPageSpreadPdf(
      pdfBytes,
      (completed, total) => {
        void reportProgress(job.id, completed, total);
      },
      { signal }
    );
  } catch (error) {
    if (error instanceof SplitTimeoutError) throw new PermanentJobError(error.message);
    throw error;
  }
  // A distinct file under the same document; the original and its annotations are never touched.
  const file = new File([result.pdfBytes as BlobPart], SPLIT_OUTPUT_FILENAME, { type: "application/pdf" });
  const stored = await storePdfFile(`${version.documentId}/page-split`, file);
  return {
    resultStorageKey: stored.storageKey,
    originalPageCount: result.originalPageCount,
    newPageCount: result.newPageCount,
    splitOriginalPageNumbers: result.splitOriginalPageNumbers
  };
}

async function runEmbedIndex(job: ProcessingJob) {
  await ensureModel();
  return indexDocument(job.subjectId, (done, total) => void reportProgress(job.id, done, total));
}
