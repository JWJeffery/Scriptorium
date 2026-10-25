import assert from "node:assert/strict";
import { toRoman, fromRoman, labelForPage, pdfPageForLabel, validateRanges, legacyRange, bookLabel } from "../apps/web/lib/page-labels.ts";

assert.equal(toRoman(4), "iv"); assert.equal(toRoman(14), "xiv"); assert.equal(toRoman(1994), "mcmxciv"); assert.equal(toRoman(0), "");
assert.equal(fromRoman("xiv"), 14); assert.equal(fromRoman("XIV"), 14); assert.equal(fromRoman("mcmxciv"), 1994);
assert.equal(fromRoman("iiii"), null, "non-canonical spellings are rejected"); assert.equal(fromRoman("abc"), null);

// Cover (unnumbered), Roman preface i..vii on PDF 3-9, body from PDF 10 as page 1, appendix A-1 from PDF 300.
const book = [
  { startPdfPage: 1, endPdfPage: 2, system: "unnumbered", startValue: 1, prefix: "" },
  { startPdfPage: 3, endPdfPage: 9, system: "roman-lower", startValue: 1, prefix: "" },
  { startPdfPage: 10, endPdfPage: 299, system: "arabic", startValue: 1, prefix: "" },
  { startPdfPage: 300, endPdfPage: null, system: "arabic", startValue: 1, prefix: "A-" }
];
assert.equal(labelForPage(book, 1), null, "cover has no number");
assert.equal(labelForPage(book, 3), "i");
assert.equal(labelForPage(book, 9), "vii");
assert.equal(labelForPage(book, 10), "1");
assert.equal(labelForPage(book, 12), "3");
assert.equal(labelForPage(book, 300), "A-1");
assert.equal(labelForPage(book, 303), "A-4");
assert.equal(labelForPage([], 5), null);

assert.equal(pdfPageForLabel(book, "iv"), 6);
assert.equal(pdfPageForLabel(book, "IV"), null, "case matters for Roman styles");
assert.equal(pdfPageForLabel(book, "217"), 226);
assert.equal(pdfPageForLabel(book, "A-4"), 303);
assert.equal(pdfPageForLabel(book, "300"), null, "body page 300 would be PDF 309, past the end of the body range");
assert.equal(pdfPageForLabel(book, "0"), null);
assert.equal(pdfPageForLabel(book, ""), null);

assert.equal(validateRanges(book), null);
assert.match(validateRanges([{ startPdfPage: 1, endPdfPage: 10, system: "arabic", startValue: 1, prefix: "" }, { startPdfPage: 5, endPdfPage: null, system: "arabic", startValue: 1, prefix: "" }]), /two ranges/);
assert.match(validateRanges([{ startPdfPage: 1, endPdfPage: null, system: "arabic", startValue: 1, prefix: "" }, { startPdfPage: 20, endPdfPage: null, system: "arabic", startValue: 1, prefix: "" }]), /last one/);
assert.match(validateRanges([{ startPdfPage: 9, endPdfPage: 3, system: "arabic", startValue: 1, prefix: "" }]), /cannot end before/);
assert.match(validateRanges([{ startPdfPage: 1, endPdfPage: null, system: "klingon", startValue: 1, prefix: "" }]), /Unknown/);

// Documents registered before ranges existed keep working.
const old = legacyRange("Mapping rule: PDF page 12 = book page 1");
assert.equal(labelForPage([old], 12), "1");
assert.equal(labelForPage([old], 11), null, "pages before the printed page 1 have no number");
assert.equal(labelForPage([legacyRange("Mapping rule: PDF page 1 = book page 1")], 7), "7");
assert.equal(bookLabel([], "Mapping rule: PDF page 3 = book page 10", 5), "12");
assert.equal(bookLabel(book, "ignored", 4), "ii");

console.log("Page labels verified: Roman/Arabic/prefixed/unnumbered ranges, label to PDF page, validation, legacy rule.");
