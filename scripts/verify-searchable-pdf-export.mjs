// Requires Node 22.6+ run with --experimental-strip-types.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createCanvas } = requireFromWeb("@napi-rs/canvas");
const { PDFDocument } = requireFromWeb("pdf-lib");
const { createSearchablePdf } = await import(pathToFileURL(join(repoRoot, "apps/web/lib/searchable-pdf.ts")).href);
const pdfjsWorker = await import(pathToFileURL(requireFromWeb.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href);
globalThis.pdfjsWorker = pdfjsWorker;
const { getDocument } = await import(pathToFileURL(requireFromWeb.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);

async function extractPdfText(pdfBytes) {
  const loadingTask = getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true });
  const document = await loadingTask.promise;
  const pages = [];
  let totalTextLength = 0;
  try {
    for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex);
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim();
        pages.push({ pageIndex, text });
        totalTextLength += text.length;
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await document.destroy();
  }
  return { pages, totalTextLength };
}

// Start with a real image-only page: visible ink exists, but the PDF has no
// text objects and therefore nothing a normal external viewer can search.
const canvas = createCanvas(600, 800);
const context = canvas.getContext("2d");
context.fillStyle = "white";
context.fillRect(0, 0, 600, 800);
context.fillStyle = "black";
context.font = "28px serif";
context.fillText("The integrity of Anglicanism", 80, 130);

const source = await PDFDocument.create();
const image = await source.embedPng(canvas.toBuffer("image/png"));
const page = source.addPage([600, 800]);
page.drawImage(image, { x: 0, y: 0, width: 600, height: 800 });
const sourceBytes = await source.save();
const before = await extractPdfText(Buffer.from(sourceBytes));
assert.equal(before.totalTextLength, 0, "the source fixture must genuinely be image-only");

const words = [
  { text: "The", left: 80, top: 102, width: 42, height: 30, confidence: 98, blockNum: 1, lineNum: 1 },
  { text: "integrity", left: 130, top: 102, width: 88, height: 30, confidence: 97, blockNum: 1, lineNum: 1 },
  { text: "of", left: 226, top: 102, width: 24, height: 30, confidence: 99, blockNum: 1, lineNum: 1 },
  { text: "Anglicanism", left: 258, top: 102, width: 128, height: 30, confidence: 96, blockNum: 1, lineNum: 1 }
];
const exported = await createSearchablePdf(sourceBytes, [{ pageIndex: 1, words }]);
assert.equal(exported.pageCount, 1);
assert.equal(exported.embeddedWordCount, words.length);

const after = await extractPdfText(Buffer.from(exported.pdfBytes));
assert.match(after.pages[0].text, /The integrity of Anglicanism/, "exported PDF must expose OCR text to an external PDF parser");
assert.ok(after.totalTextLength > 0, "exported PDF must no longer be image-only");

console.log("Searchable PDF export verifier passed (image-only input gained an externally readable invisible OCR text layer). ");
