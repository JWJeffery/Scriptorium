import type { ProcessingJob } from "@prisma/client";
import { prisma } from "../prisma.ts";
import { readStoredPdfFile, storePdfFile } from "../server-storage.ts";
import { tesseractOcrProvider } from "../tesseract-ocr-provider.ts";
import { splitTwoPageSpreadPdf } from "../pdf-page-splitter.ts";
import { ensureModel } from "../embeddings.ts";
import { indexDocument } from "../meaning-index.ts";
import { PermanentJobError, reportProgress } from "./jobs.ts";

// What each kind of long job actually does. They run in the worker (or, in inline mode, the web server)
// and report progress through the durable job record, never through memory shared with a request.

export const OCR_RUNNING_STATE = "tesseract-js-eng-v1-running";
export const OCR_FAILED_STATE = "tesseract-js-eng-v1-failed";
export const OCR_NO_TEXT_STATE = "tesseract-js-eng-v1-no-text";
export const OCR_TIMEOUT_STATE = "tesseract-js-eng-v1-timed-out";
// Generous but bounded, so a hung language-data download or stalled recognition cannot leave a book
// "running" forever. A 64-page scan legitimately needed more than 3 minutes.
const OCR_TIMEOUT_MS = 12 * 60 * 1000;
export const SPLIT_OUTPUT_FILENAME = "split-two-page-spreads.pdf";

export async function runJob(job: ProcessingJob): Promise<unknown> {
  switch (job.type) {
    case "ocr":
      return runOcr(job);
    case "page-split":
      return runPageSplit(job);
    case "embed-index":
      return runEmbedIndex(job);
    default:
      throw new PermanentJobError(`Unknown job type: ${job.type}`);
  }
}

async function runOcr(job: ProcessingJob) {
  const versionId = job.subjectId;
  const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
  if (!version?.snapshotKey) throw new PermanentJobError("No server-stored PDF file is available for this version.");
  await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: OCR_RUNNING_STATE } });
  try {
    const pdfBytes = await readStoredPdfFile(version.snapshotKey);
    const extractPromise = tesseractOcrProvider.extractText({ pdfBytes, documentId: versionId }, (completed, total) => {
      void reportProgress(job.id, completed, total);
    });
    // Promise.race does not cancel the OCR; this stops a late failure becoming an unhandled rejection.
    extractPromise.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      extractPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("OCR timed out")), OCR_TIMEOUT_MS);
      })
    ]).finally(() => timer && clearTimeout(timer));

    if (result.pages && result.pages.length > 0) {
      // OCR results replace the (empty) text spans ingestion created for a real scan.
      await prisma.$transaction([
        prisma.textSpan.deleteMany({ where: { versionId } }),
        prisma.textSpan.createMany({
          data: result.pages.map((page, index) => ({
            versionId,
            text: page.text,
            anchor: {
              pdfPageIndex: page.pageIndex,
              ocr: true,
              confidence: page.confidence,
              words: page.words,
              ...(index === 0 && result.warnings.length > 0 ? { ocrWarnings: result.warnings } : {})
            }
          }))
        }),
        prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: tesseractOcrProvider.name } })
      ]);
      return { pages: result.pages.length };
    }
    await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: OCR_NO_TEXT_STATE } });
    return { pages: 0 };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "OCR timed out";
    await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: timedOut ? OCR_TIMEOUT_STATE : OCR_FAILED_STATE } }).catch(() => undefined);
    if (timedOut) throw new PermanentJobError("OCR timed out.");
    throw error;
  }
}

export type SplitResultRecord = {
  resultStorageKey: string;
  originalPageCount: number;
  newPageCount: number;
  splitOriginalPageNumbers: number[];
};

async function runPageSplit(job: ProcessingJob): Promise<SplitResultRecord> {
  const version = await prisma.documentVersion.findUnique({ where: { id: job.subjectId } });
  if (!version?.snapshotKey) throw new PermanentJobError("No server-stored PDF file is available for this version.");
  const pdfBytes = await readStoredPdfFile(version.snapshotKey);
  const result = await splitTwoPageSpreadPdf(pdfBytes, (completed, total) => {
    void reportProgress(job.id, completed, total);
  });
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
