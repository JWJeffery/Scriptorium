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
// output instead (see extractWordsFromTsv below) after investigating a real
// production report of a page whose flat OCR text was rich (~4,258
// characters) but whose block-derived word/position array had only 16
// entries. That exact split could not be reproduced against several
// adversarial synthetic fixtures in this codebase's sandbox (dense
// prose+graphic, table/ToC layout, noise+skew, tight/low-DPI spacing,
// sideways caption/stamp text all stayed internally consistent between text
// and block-derived words in this tesseract.js version) - so the precise
// visual trigger on the real page remains unconfirmed. But tesseract.js's
// own v6 changelog documents a real, relevant mechanism: as of v6, the
// `blocks` JSON format only reports blocks Tesseract's layout analysis
// classifies as text - non-text-classified blocks (images, line segments,
// noise - exactly the kind of region a worn scan, foxing, or a library
// stamp can produce) are silently dropped from `blocks` entirely, even if
// Tesseract still recognized real text inside them for the flat `text`
// output. `tsv` is a separate, much older Tesseract export path (one row
// per recognized element at every RIL level, unaffected by that specific
// v6 blocks-JSON change) and is the standard, most complete way to recover
// per-word positions - verified word-for-word identical to blocks-derived
// output on every fixture tried here, so this is a strict improvement with
// no observed downside, not just a guess.
import "./pdfjs-worker-setup";
import { createWorker } from "tesseract.js";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OcrProvider, OcrResult, OcrWord } from "./ocr-provider";

// Higher scale = sharper rendered page = better recognition, at the cost of
// time and memory. Raised from 2 to 4: real word-position data from a live
// page showed Tesseract's word-boundary segmentation genuinely struggling
// at scale 2 on a real 1978 scan (garbage fragments like "nd"/"b"/"n"
// reported right alongside correctly-segmented real words). More pixels
// per character is Tesseract's own standard recommendation for improving
// segmentation reliability on real scans. A width- or confidence-based
// post-hoc filter to drop the garbage fragments was tried and rejected
// after checking it against the FULL real word list, not just the first
// few entries: a genuinely real, correctly-recognized word ("in", part of
// "Coggan, in Thomas Hardy's") had the same 5px width as a garbage-boxed
// "the", and confidence didn't separate them either ("the" was 97%
// confidence despite the defective box; "nd"/"b" were 91-92% despite being
// clear fragments). No single-signal filter found here was safe to ship -
// this addresses the problem at the source (segmentation quality) instead.
// Untested against the actual book (no live browser in this sandbox) -
// treat as the next thing to verify, not a confirmed fix.
const RENDER_SCALE = 4;
const LOW_CONFIDENCE_THRESHOLD = 40;
// If fewer than this fraction of the page's estimated words got a real
// position from TSV, something is still wrong even with the more complete
// TSV source - flag it rather than silently shipping a mostly-unselectable
// page. Kept well below 1.0 because legitimate partial coverage (e.g. a
// genuinely blank margin, a page that's mostly a plate/illustration with a
// short caption) is normal and shouldn't trip this.
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
