// Requires Node 22.6+ run with --experimental-strip-types.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeReadingNotes, parseReadingNotes } from "../apps/web/lib/reading-notes-import.ts";

const notes = parseReadingNotes(`Sykes, Stephen. The Integrity of Anglicanism. London: Mowbrays, 1978.

Chapter 1 The Crisis of Anglican Comprehensiveness (8-25).

“Anglicanism has no special doctrines of its own.” This is Sykes's diagnosis of the identity problem. (12).

This chapter is strongest as diagnosis rather than constructive theology. (17).`);

assert.equal(notes.length, 2);
assert.equal(notes[0].quote, "Anglicanism has no special doctrines of its own.");
assert.equal(notes[0].note, "This is Sykes's diagnosis of the identity problem.");
assert.equal(notes[1].quote, "");
assert.equal(notes[1].pageNumber, 17);

const mixed = parseReadingNotes(`Sykes, Stephen. The Integrity of Anglicanism. London: Mowbrays, 1978.

"The author states his purpose well: "So the question is, how are Anglicans to understand their communion? Spiritually, indifference would be disastrous; theologically, it would be irresponsible." (ix). My note follows the quotation.

Sykes calls modernism "the Anglican wing of European liberal Protestantism" (26). Shows the age of the text.`);
assert.equal(mixed.length, 2);
assert.match(mixed[0].quote, /^So the question/);
assert.match(mixed[0].note, /My note follows/);
assert.equal(mixed[1].pageNumber, 26);
assert.match(mixed[1].note, /Shows the age/);

const continued = parseReadingNotes(`Sykes, Stephen. The Integrity of Anglicanism. London: Mowbrays, 1978.

“Too much Anglican writing about Bishops is about the episcopacy of a church which does not exist” (98).

This is a sharp diagnosis, but the constructive argument remains weak.`);
assert.equal(continued.length, 1);
assert.match(continued[0].note, /constructive argument remains weak/);

const words = ["Anglicanism", "has", "no", "special", "doctrines", "of", "its", "own"].map((text, index) => ({
  text,
  left: 30 + index * 40,
  top: 100,
  width: 34,
  height: 12,
  confidence: 95,
  blockNum: 1,
  lineNum: 1
}));
const analyzed = analyzeReadingNotes(notes, [{ pageIndex: 12, text: words.map((word) => word.text).join(" "), words }], { basePdfPageIndex: 1, baseBookPage: 1 });
assert.equal(analyzed[0].matchStatus, "high");
assert.equal(analyzed[0].anchor?.pageNumber, 12);
assert.equal(analyzed[0].anchor?.rects.length, 8);
assert.equal(analyzed[1].matchStatus, "page-note");

const [tools, workspace, route] = await Promise.all([
  readFile("apps/web/components/ScholarlyToolsPanel.tsx", "utf8"),
  readFile("apps/web/components/ScriptoriumMilestoneOnePersisted.tsx", "utf8"),
  readFile("apps/web/app/api/reading-notes/route.ts", "utf8")
]);
assert.match(tools, /Import reading notes/);
assert.match(tools, /Preview in book/);
assert.match(workspace, /onPreviewReadingNote=\{previewReadingNote\}/);
assert.match(route, /imported-reading-notes/);

console.log("Reading-notes import verified: parsing, page notes, OCR anchoring, review UI, and persisted records are wired.");
