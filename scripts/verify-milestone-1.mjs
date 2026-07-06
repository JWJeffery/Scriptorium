import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fixture = JSON.parse(await readFile("fixtures/milestone-1/pdf-workflow-record.json", "utf8"));

function bookPageLabel(pageMap) {
  return String(pageMap.baseBookPage + pageMap.currentPdfPageIndex - pageMap.basePdfPageIndex);
}

function citationText(document, locator) {
  const source = document.source;
  const author = source.author || "Unknown author";
  const title = source.title || document.title || document.filename;
  const imprintParts = [source.place, source.publisher].filter(Boolean).join(": ");
  const imprint = [imprintParts, source.year].filter(Boolean).join(", ");
  const publication = imprint ? ` (${imprint})` : "";
  return `${author}, ${title}${publication}, ${locator}.`;
}

function verifyPageMap(record) {
  const computedBookPage = bookPageLabel(record.document.pageMap);
  assert.equal(computedBookPage, record.document.pageMap.bookPageLabel, "book page label must be derived from the stored PDF-page mapping");
  assert.equal(computedBookPage, record.annotation.bookPageLabel, "annotation locator must match mapped book page");
}

function verifyCitation(record) {
  const computedCitation = citationText(record.document, record.annotation.bookPageLabel);
  assert.equal(computedCitation, record.annotation.citationText, "generated citation must match the mapped book-page locator");
}

function verifyAnchor(record) {
  const { anchor } = record.annotation;
  assert.equal(anchor.selectedText, record.annotation.selectedText, "anchor selected text must match annotation selected text");
  assert.equal(anchor.pageNumber, record.annotation.pdfPageIndex, "anchor page must match annotation PDF page");
  assert.ok(anchor.beforeContext.length > 0, "anchor must preserve before-context for recovery");
  assert.ok(anchor.afterContext.length > 0, "anchor must preserve after-context for recovery");
  assert.ok(anchor.rects.length > 0, "anchor must preserve at least one highlight rectangle");
  for (const rect of anchor.rects) {
    assert.ok(rect.width > 0, "highlight rectangle width must be positive");
    assert.ok(rect.height > 0, "highlight rectangle height must be positive");
  }
}

verifyPageMap(fixture);
verifyCitation(fixture);
verifyAnchor(fixture);

console.log("Milestone 1 fixture verified: page map, citation, and anchor recovery data are coherent.");
