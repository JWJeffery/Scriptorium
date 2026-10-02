// Live check of /api/search against a running server with MySQL (CI + local).
import assert from "node:assert/strict";
import { textPdf } from "./lib-test-pdf.mjs";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const json = async (response) => {
  assert.ok(response.ok, `${response.url} -> ${response.status}`);
  return await response.json();
};
const unique = `zyxwv${Date.now()}`;

const bytes = await textPdf([
  ["Preface", "Nothing relevant on this page."],
  ["The doctrine of the integrity of the church", `is discussed here. Marker ${unique}.`],
  ["Further on, the unity of the church is treated", "separately from integrity."]
]);
const form = new FormData();
form.set("file", new File([bytes], "search-fixture.pdf", { type: "application/pdf" }));
form.set("title", `Search fixture ${unique}`);
const uploaded = await json(await fetch(`${baseUrl}/api/milestone-one/files`, { method: "POST", body: form }));
const documentId = uploaded.document.id;

const exact = await json(await fetch(`${baseUrl}/api/search?q=${encodeURIComponent("integrity church")}&documentId=${documentId}`));
assert.equal(exact.counts.pages, 2, "both pages containing both words match");
assert.equal(exact.pages[0].pdfPageIndex, 2, "the page where the words appear together ranks first");
assert.equal(exact.pages[0].bookPage, "2", "book page is derived from the mapping");
assert.ok(exact.pages[0].snippet.match.length > 0);

const phrase = await json(await fetch(`${baseUrl}/api/search?q=${encodeURIComponent('"unity of the church"')}&documentId=${documentId}`));
assert.equal(phrase.counts.pages, 1);
assert.equal(phrase.pages[0].pdfPageIndex, 3);

const marker = await json(await fetch(`${baseUrl}/api/search?q=${unique}`));
assert.equal(marker.counts.pages, 1, "searching all documents finds the unique marker");
assert.equal(marker.pages[0].documentId, documentId);

const none = await json(await fetch(`${baseUrl}/api/search?q=${encodeURIComponent("qqqqnotpresent")}&documentId=${documentId}`));
assert.equal(none.counts.pages, 0);

const tooShort = await fetch(`${baseUrl}/api/search?q=a`);
assert.equal(tooShort.status, 400);

const related = await json(await fetch(`${baseUrl}/api/search?mode=related&q=${encodeURIComponent("church integrity doctrine")}&documentId=${documentId}`));
assert.ok(related.counts.pages >= 1 && related.pages[0].pdfPageIndex === 2, "related search ranks the closest page first");

// Notes and highlights are searchable, including tags.
const ann = await json(await fetch(`${baseUrl}/api/milestone-one/annotations`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    documentId, versionId: uploaded.version.id, sourceId: uploaded.source.id, pageMapId: uploaded.pageMap.id,
    colorKey: "blue", selectedText: "the integrity of the church", note: `Remember ${unique} argument`, tags: ["ecclesiology"],
    anchor: { selectedText: "the integrity of the church", pageNumber: 2, rects: [] },
    citationStyle: "sbl-note", citationText: "Cite.", locatorValue: "2"
  })
}));
const notes = await json(await fetch(`${baseUrl}/api/search?q=${unique}&documentId=${documentId}`));
assert.equal(notes.counts.annotations, 1);
assert.equal(notes.annotations[0].pdfPageIndex, 2);
assert.deepEqual(notes.annotations[0].tags, ["ecclesiology"]);
const byTag = await json(await fetch(`${baseUrl}/api/search?q=ecclesiology&documentId=${documentId}`));
assert.equal(byTag.counts.annotations, 1, "tags are searched");
await fetch(`${baseUrl}/api/milestone-one/annotations?annotationId=${ann.annotation.id}`, { method: "DELETE" });

console.log("Search API verified: exact, phrase, cross-document, related ranking, notes, and tags.");
