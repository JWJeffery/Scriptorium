// Requires Node 22.6+ run with --experimental-strip-types.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { detectLikelyScanned, nullOcrProvider, OcrNotConfiguredError } from "../apps/web/lib/ocr-provider.ts";

// A near-empty text layer relative to page count should flag as likely scanned.
const scanned = detectLikelyScanned({ extractedTextLength: 15, pageCount: 30 });
assert.equal(scanned.likelyScanned, true);
assert.ok(scanned.reason.toLowerCase().includes("scanned"));

// A normal text-bearing PDF should not.
const real = detectLikelyScanned({ extractedTextLength: 60000, pageCount: 30 });
assert.equal(real.likelyScanned, false);

// Boundary: pageCount must not be allowed to reach zero (would divide by zero).
const noPages = detectLikelyScanned({ extractedTextLength: 0, pageCount: 0 });
assert.ok(Number.isFinite(noPages.charsPerPage), "charsPerPage must stay finite even with a zero page count");

// The null provider must fail loudly, not silently return empty text —
// silently returning "" would be indistinguishable from "OCR ran and found
// nothing," which is the exact confusion this contract exists to prevent.
await assert.rejects(
  () => nullOcrProvider.extractText({ pdfBytes: Buffer.alloc(0), documentId: "doc-1" }),
  OcrNotConfiguredError
);

const route = await readFile("apps/web/app/api/milestone-sixteen/ocr-status/route.ts", "utf8");
for (const term of ["detectLikelyScanned", "nullOcrProvider", "OcrNotConfiguredError", "501"]) {
  assert.ok(route.includes(term), `ocr-status route missing contract term: ${term}`);
}

const providerModule = await readFile("apps/web/lib/ocr-provider.ts", "utf8");
assert.ok(!/tesseract|google.?vision|aws.?textract/i.test(providerModule), "this gate must not silently bundle a real OCR engine — the contract must stay honestly unimplemented until a provider is deliberately wired in");

console.log("Milestone 17 OCR pipeline contract verifier passed (detection logic real; OCR engine intentionally not implemented).");
