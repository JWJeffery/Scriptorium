import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fixture = JSON.parse(await readFile("fixtures/milestone-3/text-markdown-workflow-records.json", "utf8"));
const allowedFormats = new Set(["TXT", "MARKDOWN"]);
const allowedColors = new Set(["yellow", "green", "blue", "pink", "orange", "purple", "teal", "red", "gray", "gold"]);

function lineForOffset(text, offset) {
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

function locatorFor(anchor) {
  return anchor.lineStart === anchor.lineEnd ? String(anchor.lineStart) : `${anchor.lineStart}-${anchor.lineEnd}`;
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

assert.ok(Array.isArray(fixture.records), "fixture.records must be an array");
assert.equal(fixture.records.length, 2, "fixture must cover both TXT and Markdown");

const seenFormats = new Set();

for (const record of fixture.records) {
  seenFormats.add(record.format);
  assert.ok(allowedFormats.has(record.format), `unsupported format ${record.format}`);
  assert.equal(record.document.kind, record.format, `${record.format} document kind must match fixture format`);
  assert.ok(record.text.length > 0, `${record.format} fixture must include text`);
  assert.ok(allowedColors.has(record.annotation.colorKey), `${record.format} uses unknown highlight color`);

  const anchor = record.annotation.anchor;
  assert.equal(anchor.locatorKind, "line", `${record.format} anchor must use line locator kind`);
  assert.equal(anchor.pageNumber, 1, `${record.format} text snapshots use pageNumber 1 compatibility anchor`);
  assert.ok(Number.isInteger(anchor.startOffset), `${record.format} anchor needs integer startOffset`);
  assert.ok(Number.isInteger(anchor.endOffset), `${record.format} anchor needs integer endOffset`);
  assert.ok(anchor.endOffset > anchor.startOffset, `${record.format} anchor endOffset must be after startOffset`);
  assert.equal(record.text.slice(anchor.startOffset, anchor.endOffset), record.annotation.selectedText, `${record.format} selected text must recover exactly from offsets`);
  assert.equal(anchor.selectedText, record.annotation.selectedText, `${record.format} anchor text must match annotation text`);
  assert.equal(lineForOffset(record.text, anchor.startOffset), anchor.lineStart, `${record.format} lineStart must derive from startOffset`);
  assert.equal(lineForOffset(record.text, anchor.endOffset), anchor.lineEnd, `${record.format} lineEnd must derive from endOffset`);
  assert.equal(locatorFor(anchor), record.annotation.locatorValue, `${record.format} locator must derive from anchor lines`);
  assert.equal(record.annotation.locatorType, "line", `${record.format} citation locatorType must be line`);
  assert.equal(citationText(record.document, record.annotation.locatorValue), record.annotation.citationText, `${record.format} generated citation must use line locator`);
  assert.ok(anchor.beforeContext.length > 0, `${record.format} anchor must preserve before-context`);
  assert.ok(anchor.afterContext.length > 0, `${record.format} anchor must preserve after-context`);
  assert.deepEqual(anchor.rects, [], `${record.format} text anchors do not use PDF rectangles`);
}

assert.ok(seenFormats.has("TXT"), "TXT fixture missing");
assert.ok(seenFormats.has("MARKDOWN"), "Markdown fixture missing");

console.log("Milestone 3 TXT/Markdown fixtures verified: offsets, line locators, highlights, citations, and recovery data are coherent.");
