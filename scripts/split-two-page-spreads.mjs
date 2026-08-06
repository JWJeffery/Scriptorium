// Physically splits a PDF whose pages are two-page spreads (scanned as one
// image per book-page-pair) into a PDF with one real page per book page.
//
// Usage:
//   node --experimental-strip-types scripts/split-two-page-spreads.mjs <input.pdf> <output.pdf>
//
// Requires Node 22.6+ run with --experimental-strip-types (same
// requirement as this repo's other scripts/ tools).
//
// This does NOT touch any existing document, version, page-map setting,
// or saved annotation in the app - it reads the input PDF and writes a
// brand new PDF file. Re-upload the output file through the app's normal
// upload flow as a new document to actually start using it; the original
// document and everything saved against it are untouched.
import { readFile, writeFile } from "node:fs/promises";
import { splitTwoPageSpreadPdf } from "../apps/web/lib/pdf-page-splitter.ts";

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error("Usage: node --experimental-strip-types scripts/split-two-page-spreads.mjs <input.pdf> <output.pdf>");
  process.exit(1);
}

console.log(`Reading ${inputPath}...`);
const inputBytes = await readFile(inputPath);

console.log("Rendering each page to detect real two-page-spread gutters (this can take a while for a long book - one render pass per page)...");
const result = await splitTwoPageSpreadPdf(inputBytes);

await writeFile(outputPath, result.pdfBytes);

console.log("");
console.log(`Done. Wrote ${outputPath}`);
console.log(`  Original page count: ${result.originalPageCount}`);
console.log(`  New page count: ${result.newPageCount}`);
if (result.splitOriginalPageNumbers.length > 0) {
  console.log(`  ${result.splitOriginalPageNumbers.length} of ${result.originalPageCount} original pages were detected as two-page spreads and split into two.`);
  console.log(`  Original page numbers split: ${result.splitOriginalPageNumbers.join(", ")}`);
} else {
  console.log("  No pages were detected as two-page spreads - nothing was split. If you expected splits here, the gutter-detection threshold may need adjusting for this particular scan.");
}
const unsplitCount = result.originalPageCount - result.splitOriginalPageNumbers.length;
if (unsplitCount > 0 && result.splitOriginalPageNumbers.length > 0) {
  console.log(`  ${unsplitCount} original page(s) looked like genuine single pages (no real gutter found) and were kept as-is, not split.`);
}
console.log("");
console.log("Re-upload this file through the app's normal upload flow as a new document to start using it.");
console.log("The original document, its page-map settings, and any saved annotations are untouched.");
