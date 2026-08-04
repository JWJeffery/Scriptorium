// Real OCR provider, English only. Renders each PDF page to a PNG via
// pdfjs-dist + @napi-rs/canvas (no system Cairo/Poppler dependency - both
// packages ship prebuilt, portable binaries), then runs Tesseract over each
// page image. This is the concrete implementation the OcrProvider contract
// in ocr-provider.ts was deliberately built to accept later.
//
// Scope: English/Latin script only, matching what this corpus needs today.
// Adding another language later means adding another lang code to
// createWorker and, for non-Latin scripts, checking Tesseract's accuracy on
// the specific script before trusting it the way the Unicode-aware search
// fix (gate 18) already trusts Greek/Ge'ez/Syriac/Coptic text.
//
// WORD-POSITION SOURCE: this used to walk the `blocks` JSON output
// (block.paragraphs[].lines[].words[]). Switched to parsing the `tsv`
// output instead (see extractWordsFromTsv below) - a separate, older
// Tesseract export path (one row per recognized word at every RIL level)
// not subject to tesseract.js v6's "only text-classified blocks are
// reported in blocks JSON" behavior. Verified word-for-word identical to
// blocks-derived output on every fixture tried, a real improvement
// independent of everything below.
//
// PAGE SEGMENTATION MODE AND CONTRAST - the actual root cause and fix,
// found by testing directly against a real page image (Josh exported the
// problem page as its own PDF and uploaded it) instead of guessing and
// shipping to a live 128-page run, which is how every earlier attempt in
// this file's history went. Running that real page through the native
// `tesseract` CLI at tesseract.js's default page-segmentation mode (PSM 3,
// "fully automatic") returned "Empty page!!" - zero words, nothing - on
// this exact page. That's the real root cause of the whole
// sparse/garbled-words saga: PSM 3's automatic layout analysis was failing
// outright on this book's mix of a stylized library-stamp block, dense
// small-print copyright/catalog text, and a large blank two-page-spread
// gutter - not timing out, not needing more resolution, just failing to
// find any text region worth reading, then falling back to whatever
// fragments its confused layout analysis could salvage.
// PSM.SINGLE_BLOCK (6, "assume a single uniform block of text") fixed this
// completely - tested against the real page via both the native tesseract
// CLI and this exact tesseract.js library, word-for-word correct output
// ("There's this to be said for the Church [of England]..." exactly
// matching the real printed epigraph). A simple 2x contrast-enhancement
// pass on the rendered image (see applyContrastEnhancement below) closed
// the small remaining gap on the harder parts of the page (the stylized
// stamp, small catalog print). Confirmed via tesseract.js directly at both
// the original RENDER_SCALE=2 and the since-reverted RENDER_SCALE=4 -
// resolution was never the actual problem, so RENDER_SCALE stays at its
// original, cheaper value.
import "./pdfjs-worker-setup";
import { createWorker, PSM } from "tesseract.js";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OcrProvider, OcrResult, OcrWord } from "./ocr-provider";

// Higher scale = sharper rendered page = better recognition, at the cost of
// time and memory - in theory. Was raised from 2 to 4 on a hypothesis that
// turned out to be wrong (real data from a live page showed scale 4 alone
// made word-segmentation worse, not better - more pixels to fragment on,
// not fewer mistakes). The real fix was PSM + contrast (below), verified to
// work fine at the original, cheaper scale of 2 - no reason to pay for
// resolution the actual problem never needed.
const RENDER_SCALE = 2;
const LOW_CONFIDENCE_THRESHOLD = 40;
// Multiplier for the contrast-enhancement pass applied to each rendered
// page before OCR (see applyContrastEnhancement). 2.0 was tested directly
// against the real problem page and confirmed to produce a word-for-word
// correct transcription of it.
const CONTRAST_FACTOR = 2.0;
// If fewer than this fraction of the page's estimated words got a real
// position from TSV, something is still wrong - flag it rather than
// silently shipping a mostly-unselectable page. Kept well below 1.0
// because legitimate partial coverage (e.g. a genuinely blank margin, a
// page that's mostly a plate/illustration with a short caption) is normal
// and shouldn't trip this.
const WORD_COVERAGE_WARNING_THRESHOLD = 0.5;

// Tesseract's TSV output: one row per recognized element at every RIL
// level, tab-separated:
// level  page_num  block_num  par_num  line_num  word_num  left  top  width  height  conf  text
// Level 5 is a word row (1=page, 2=block, 3=paragraph, 4=line). Only level
// 5 rows carry real text/confidence - this is the standard Tesseract TSV
// contract, stable across versions, independent of the `blocks` JSON
// format's own (separately versioned) shape.
const TSV_WORD_LEVEL = 5;

function extractWordsFromTsv(tsv: string | null, renderScale: number): OcrWord[] {
  if (!tsv) return [];
  const rows = tsv.trim().split("\n").slice(1); // drop header row
  const words: OcrWord[] = [];
  for (const row of rows) {
    const cols = row.split("\t");
    if (Number(cols[0]) !== TSV_WORD_LEVEL) continue;
    const text = cols[11];
    if (!text || !text.trim()) continue;
    words.push({
      text,
      left: Number(cols[6]) / renderScale,
      top: Number(cols[7]) / renderScale,
      width: Number(cols[8]) / renderScale,
      height: Number(cols[9]) / renderScale,
      confidence: Number(cols[10]),
      blockNum: Number(cols[2]),
      lineNum: Number(cols[4])
    });
  }
  return words;
}

// Converts to grayscale and pushes each pixel away from the image's own
// mean brightness by `factor` - the same formula Python's PIL uses for
// ImageEnhance.Contrast (degenerate = mean-gray image, result = degenerate
// * (1 - factor) + original * factor, which simplifies to
// mean + (pixel - mean) * factor). This exact formula, at factor 2.0, is
// what was verified directly against the real problem page - not a
// generic "increase contrast" gesture, this specific transform. Mutates
// the canvas in place.
function applyContrastEnhancement(canvas: Canvas, factor: number): void {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const pixelCount = data.length / 4;
  const gray = new Float64Array(pixelCount);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = g;
    sum += g;
  }
  const mean = sum / pixelCount;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = Math.min(255, Math.max(0, mean + (gray[p] - mean) * factor));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    // alpha (data[i + 3]) left untouched
  }
  ctx.putImageData(imageData, 0, 0);
}

export class TesseractOcrProvider implements OcrProvider {
  readonly name = "tesseract-js-eng-v1";

  async extractText(
    input: { pdfBytes: Buffer; documentId: string },
    onPageComplete?: (completed: number, total: number) => void
  ): Promise<OcrResult> {
    const loadingTask = getDocument({
      data: new Uint8Array(input.pdfBytes),
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true
    });
    const doc = await loadingTask.promise;
    const worker = await createWorker("eng");
    // See the file header - PSM 3 (tesseract.js's default) returned zero
    // words at all on the real page this whole investigation traced back
    // to. SINGLE_BLOCK is what was actually verified against that page.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const pages: { pageIndex: number; text: string; confidence: number; words: OcrWord[] }[] = [];
    const warnings: string[] = [];

    try {
      for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex++) {
        const page = await doc.getPage(pageIndex);
        try {
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext("2d");

          // pdfjs's render() expects a DOM-shaped CanvasRenderingContext2D.
          // @napi-rs/canvas implements the subset pdfjs actually calls, but
          // TypeScript doesn't know that, hence the cast.
          await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
          applyContrastEnhancement(canvas, CONTRAST_FACTOR);

          const pngBuffer = canvas.toBuffer("image/png");
          // tsv: true asks Tesseract for its standard per-word TSV export
          // (see extractWordsFromTsv above for why this replaced blocks:
          // true) - real positioned words instead of trusting pdf.js's own
          // (sometimes corrupted - see the NGUCA incident) text layer for
          // pages OCR actually ran on.
          const { data } = await worker.recognize(pngBuffer, {}, { tsv: true });
          const text = data.text.trim();
          const words = extractWordsFromTsv(data.tsv, RENDER_SCALE);
          pages.push({ pageIndex, text, confidence: data.confidence, words });

          // Persisted diagnostics, not just console.log: a prior session
          // lost the one log line that would have pinned down a real
          // word-count discrepancy because the sandbox terminal reset mid
          // multi-page run before it could be read. Anything worth knowing
          // about a page's OCR quality needs to survive that, so it goes
          // into `warnings` (already surfaced to Josh in the panel's status
          // line) rather than only stdout.
          const naiveTextWordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
          const wordCoverage = naiveTextWordCount > 0 ? words.length / naiveTextWordCount : 1;
          // eslint-disable-next-line no-console
          console.log(
            `[OCR-SERVER-DEBUG] page ${pageIndex}/${doc.numPages}: confidence=${data.confidence.toFixed(1)} textLength=${text.length} naiveTextWordCount=${naiveTextWordCount} tsvWordCount=${words.length} coverage=${(wordCoverage * 100).toFixed(0)}%`
          );

          if (text && data.confidence < LOW_CONFIDENCE_THRESHOLD) {
            warnings.push(
              `Page ${pageIndex}: low OCR confidence (${data.confidence.toFixed(0)}%) - recognized text may be unreliable and worth checking against the original scan.`
            );
          }
          if (naiveTextWordCount > 0 && wordCoverage < WORD_COVERAGE_WARNING_THRESHOLD) {
            warnings.push(
              `Page ${pageIndex}: word-position data covers only ${words.length} of an estimated ${naiveTextWordCount} words (${(wordCoverage * 100).toFixed(0)}%) - the recognized text itself may look complete, but drag-selection/highlighting on this page will likely be incomplete or missing in places. Worth checking this page against the original scan.`
            );
          }
        } finally {
          page.cleanup();
          onPageComplete?.(pageIndex, doc.numPages);
        }
      }
    } finally {
      await worker.terminate();
      await doc.destroy();
    }

    return {
      text: pages.map((page) => page.text).join("\n\n"),
      warnings,
      pages
    };
  }
}

export const tesseractOcrProvider = new TesseractOcrProvider();
