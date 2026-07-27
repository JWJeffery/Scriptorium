// OCR pipeline contract (Milestone 16).
//
// FILE_INGESTION.md lists "OCR pipeline for scanned PDFs" under "Later" —
// this module builds the detection logic and the provider hook so that
// slice can be wired in later without touching call sites, but it does NOT
// implement real OCR (no bundled OCR engine, no external OCR service call).
// Scope is deliberately limited to:
//   1. detecting that a document version is likely a scanned/image-only PDF
//      with no real text layer, and
//   2. a pluggable provider interface that a real OCR implementation can
//      satisfy later.
// Calling the null provider is meant to fail loudly and explain why, not to
// silently pretend OCR happened.

export type OcrResult = {
  text: string;
  warnings: string[];
  pages?: { pageIndex: number; text: string; confidence: number }[];
};

export interface OcrProvider {
  readonly name: string;
  extractText(input: { pdfBytes: Buffer; documentId: string }): Promise<OcrResult>;
}

export class OcrNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(`OCR provider "${providerName}" is not configured. This build only ships OCR detection, not an OCR engine.`);
    this.name = "OcrNotConfiguredError";
  }
}

/**
 * Stand-in provider until a real OCR engine/service is wired up. Throws
 * rather than returning empty text, so a caller can't mistake "no provider"
 * for "OCR ran and found nothing."
 */
export const nullOcrProvider: OcrProvider = {
  name: "null-ocr-provider-v1",
  async extractText() {
    throw new OcrNotConfiguredError("null-ocr-provider-v1");
  }
};

export type ScanDetectionInput = {
  extractedTextLength: number;
  pageCount: number;
};

export type ScanDetectionResult = {
  likelyScanned: boolean;
  charsPerPage: number;
  reason: string;
};

const CHARS_PER_PAGE_THRESHOLD = 20;

/**
 * Heuristic, not certainty: a PDF whose extracted text is near-empty
 * relative to its page count almost always means the pages are scanned
 * images with no embedded text layer, rather than a genuinely short book.
 * False positives are possible for very sparse title/blank pages, which is
 * why this returns a flag for review, not an automatic reclassification.
 */
export function detectLikelyScanned(input: ScanDetectionInput): ScanDetectionResult {
  const pageCount = Math.max(input.pageCount, 1);
  const charsPerPage = input.extractedTextLength / pageCount;
  const likelyScanned = charsPerPage < CHARS_PER_PAGE_THRESHOLD;

  return {
    likelyScanned,
    charsPerPage,
    reason: likelyScanned
      ? `Extracted text averages ${charsPerPage.toFixed(1)} characters/page across ${pageCount} page(s), below the ${CHARS_PER_PAGE_THRESHOLD}-character/page threshold — consistent with a scanned/image-only PDF.`
      : `Extracted text averages ${charsPerPage.toFixed(1)} characters/page across ${pageCount} page(s) — a real text layer appears present.`
  };
}
