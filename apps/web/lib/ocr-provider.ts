// OCR pipeline contract (Milestone 16).
//
// The concrete English Tesseract implementation lives in
// tesseract-ocr-provider.ts. This module holds the provider-neutral types,
// scan-detection heuristic, and an explicit null provider for environments
// that deliberately choose not to configure an OCR engine. Calling that
// fallback must fail loudly rather than pretending an empty result is OCR.

export type OcrWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  // Tesseract's own block/line grouping for this word (from TSV columns
  // block_num/line_num). Not used for rendering position - purely an
  // identity signal so a rectangle-based drag selection that geometrically
  // sweeps across two visually distinct regions (e.g. a main paragraph and
  // a smaller marginal citation sitting on an overlapping y-range) can tell
  // they're different blocks and avoid silently merging fragments from both
  // into one nonsensical selection. line_num resets per block, so the two
  // together (not line_num alone) identify a real line.
  blockNum?: number;
  lineNum?: number;
};

export type OcrResult = {
  text: string;
  warnings: string[];
  pages?: { pageIndex: number; text: string; confidence: number; words?: OcrWord[] }[];
};

export interface OcrProvider {
  readonly name: string;
  extractText(
    input: { pdfBytes: Buffer; documentId: string },
    onPageComplete?: (completed: number, total: number) => void
  ): Promise<OcrResult>;
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
