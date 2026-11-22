// Test helper for verify-ocr-resume.mjs (run with tsx from apps/web): OCRs a PDF in one uninterrupted
// pass, straight through the provider with no batching, resume or abort, and prints the TextSpans the
// OCR job has always written for that result: one per page, in page order, warnings on the first.
//   node node_modules/tsx/dist/cli.mjs ../../scripts/lib-ocr-reference.mts <pdfPath> <outJson>
import { readFile, writeFile } from "node:fs/promises";
import { tesseractOcrProvider } from "../apps/web/lib/tesseract-ocr-provider.ts";

const [pdfPath, outPath] = process.argv.slice(2);
const result = await tesseractOcrProvider.extractText({ pdfBytes: await readFile(pdfPath), documentId: "reference" });
const spans = (result.pages ?? []).map((page, index) => ({
  text: page.text,
  anchor: {
    pdfPageIndex: page.pageIndex,
    ocr: true,
    confidence: page.confidence,
    words: page.words,
    ...(index === 0 && result.warnings.length > 0 ? { ocrWarnings: result.warnings } : {})
  }
}));
await writeFile(outPath, JSON.stringify(spans));
