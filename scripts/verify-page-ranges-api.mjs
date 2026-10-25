// Live check of /api/page-ranges (numbering ranges) against a running server with MySQL.
import assert from "node:assert/strict";
import { textPdf } from "./lib-test-pdf.mjs";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const call = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json().catch(() => null) };
};
const put = (body) => call("/api/page-ranges", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const unique = `rngmark${Date.now()}`;

// 6 pages: cover, preface (2 pages), body (3 pages). The marker is on PDF page 5.
const pages = [["Cover"], ["Preface one"], ["Preface two"], ["Body start"], [`Chapter text ${unique}`], ["Body end"]];
const form = new FormData();
form.set("file", new File([await textPdf(pages)], "ranges.pdf", { type: "application/pdf" }));
form.set("title", `Ranges fixture ${unique}`);
const uploaded = (await call("/api/core/files", { method: "POST", body: form })).body;
const versionId = uploaded.version.id;

const before = await call(`/api/page-ranges?versionId=${versionId}`);
assert.equal(before.body.source, "legacy", "a fresh document reports its original single rule");
assert.equal(before.body.ranges.length, 1);

const roman = [
  { startPdfPage: 1, endPdfPage: 1, system: "unnumbered", startValue: 1, prefix: "" },
  { startPdfPage: 2, endPdfPage: 3, system: "roman-lower", startValue: 1, prefix: "" },
  { startPdfPage: 4, endPdfPage: null, system: "arabic", startValue: 1, prefix: "" }
];
const saved = await put({ versionId, ranges: roman });
assert.equal(saved.status, 200);
assert.equal(saved.body.source, "saved");
assert.equal(saved.body.ranges.length, 3);

const search = (await call(`/api/search?q=${unique}&documentId=${uploaded.document.id}`)).body;
assert.equal(search.pages[0].pdfPageIndex, 5);
assert.equal(search.pages[0].bookPage, "2", "PDF page 5 is body page 2 under the saved numbering");
const preface = (await call(`/api/search?q=${encodeURIComponent("Preface two")}&documentId=${uploaded.document.id}`)).body;
assert.equal(preface.pages[0].bookPage, "ii", "the preface is cited in Roman numerals");
const cover = (await call(`/api/search?q=Cover&documentId=${uploaded.document.id}`)).body;
assert.equal(cover.pages[0].bookPage, null, "the cover has no printed number");

assert.equal((await put({ versionId, ranges: [{ startPdfPage: 1, endPdfPage: 5, system: "arabic", startValue: 1, prefix: "" }, { startPdfPage: 3, endPdfPage: null, system: "arabic", startValue: 1, prefix: "" }] })).status, 400, "overlapping ranges are refused");
assert.equal((await put({ versionId, ranges: [{ startPdfPage: 1, endPdfPage: null, system: "klingon", startValue: 1, prefix: "" }] })).status, 400);
assert.equal((await put({ versionId: "nope", ranges: [] })).status, 404);
const still = await call(`/api/page-ranges?versionId=${versionId}`);
assert.equal(still.body.ranges.length, 3, "a refused save changes nothing");

// Correcting the numbering updates the citation of a saved annotation.
const ann = (await call("/api/core/annotations", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ documentId: uploaded.document.id, versionId, sourceId: uploaded.source.id, pageMapId: uploaded.pageMap.id, colorKey: "gold", selectedText: "Chapter text", note: "", tags: [], anchor: { selectedText: "Chapter text", pageNumber: 5, rects: [] }, citationStyle: "sbl-note", citationText: "Old, 5.", locatorValue: "5" })
})).body.annotation;
const fixed = await call("/api/core/annotations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ annotationId: ann.id, locatorValue: "2", citationText: "Old, 2." }) });
assert.equal(fixed.status, 200);
const workspace = (await call(`/api/core/workspace?documentId=${uploaded.document.id}`)).body;
const citation = workspace.document.versions[0].annotations[0].citations[0];
assert.equal(citation.locatorValue, "2");
assert.equal(citation.generatedText, "Old, 2.");
assert.equal((await call("/api/core/annotations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ annotationId: ann.id, locatorValue: "3" }) })).status, 400, "locator and citation text travel together");

const cleared = await put({ versionId, ranges: [] });
assert.equal(cleared.body.source, "legacy", "clearing returns to the original single rule");

console.log("Page ranges API verified: legacy fallback, save, Roman/unnumbered labels in search, validation, citation update, clear.");
