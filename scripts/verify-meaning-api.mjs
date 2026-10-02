// Live check of the by-meaning index: build, search, fall back, remove.
// The server must run with SCRIPTORIUM_FAKE_EMBEDDINGS=1 (a deterministic test embedder),
// so this never downloads the real model. verify-meaning-real-model.mjs covers the real one.
import assert from "node:assert/strict";
import { textPdf } from "./lib-test-pdf.mjs";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const call = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json().catch(() => null) };
};
const send = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const stamp = Date.now();

const form = new FormData();
form.set("file", new File([await textPdf([
  ["Baptism and the washing of regeneration", "water spirit font sacrament newborn"],
  ["The harvest of barley and wheat", "granary sickle threshing floor autumn"],
  ["Councils define doctrine for bishops", "creed synod canon ecumenical assembly"]
])], "meaning.pdf", { type: "application/pdf" }));
form.set("title", `Meaning fixture ${stamp}`);
const uploaded = (await call("/api/milestone-one/files", { method: "POST", body: form })).body;
const documentId = uploaded.document.id;

// Before indexing: honest fallback to shared words
const before = (await call(`/api/search?mode=related&q=${encodeURIComponent("sacrament of the font")}&documentId=${documentId}`)).body;
assert.equal(before.method, "words");
assert.match(before.methodNote, /not been indexed/);

// Build the index and wait for it
assert.equal((await call("/api/embeddings", send("POST", { documentId }))).status, 202);
let status;
for (let attempt = 0; attempt < 60; attempt += 1) {
  status = (await call("/api/embeddings")).body.documents.find((entry) => entry.documentId === documentId);
  if (status.progress?.state === "finished" || status.progress?.state === "failed") break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
assert.equal(status.progress.state, "finished", status.progress?.error);
assert.equal(status.pagePassages, 3, "one passage per short page");
assert.equal((await call("/api/embeddings", send("POST", { documentId: "nope" }))).status, 404);

// Search by meaning (the fake embedder compares word overlap, so use words from the target page)
const found = (await call(`/api/search?mode=related&q=${encodeURIComponent("sacrament of the font water")}&documentId=${documentId}`)).body;
assert.equal(found.method, "meaning");
assert.deepEqual(found.unindexed, [], "searching one indexed book never lists that book as unindexed");
assert.equal(found.pages[0].pdfPageIndex, 1, "the baptism page ranks first");
assert.ok(found.pages[0].score > found.pages[found.pages.length - 1].score || found.pages.length === 1);
const councils = (await call(`/api/search?mode=related&q=${encodeURIComponent("synod creed canon")}&documentId=${documentId}`)).body;
assert.equal(councils.pages[0].pdfPageIndex, 3);
assert.equal((await call(`/api/search?mode=related&q=${encodeURIComponent("zzqx qqzz")}&documentId=${documentId}`)).body.counts.pages, 0, "nothing similar -> nothing returned");

// Notes are indexed too, after an update
await call("/api/milestone-one/annotations", send("POST", {
  documentId, versionId: uploaded.version.id, sourceId: uploaded.source.id, pageMapId: uploaded.pageMap.id,
  colorKey: "blue", selectedText: "the washing of regeneration", note: "reflection on christening rites", tags: [],
  anchor: { selectedText: "x", pageNumber: 1, rects: [] }, citationStyle: "sbl-note", citationText: "Cite.", locatorValue: "1"
}));
await call("/api/embeddings", send("POST", { documentId }));
for (let attempt = 0; attempt < 60; attempt += 1) {
  status = (await call("/api/embeddings")).body.documents.find((entry) => entry.documentId === documentId);
  if (status.progress?.state === "finished" && status.notePassages === 1) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
assert.equal(status.notePassages, 1, "a new note is added to the index; unchanged pages are not re-read");
assert.equal(status.pagePassages, 3);
const withNote = (await call(`/api/search?mode=related&q=${encodeURIComponent("christening rites reflection")}&documentId=${documentId}`)).body;
assert.ok(withNote.annotations.length >= 1 && withNote.annotations[0].note.includes("christening"));

// Another book that has not been indexed is named, not silently ignored
const second = new FormData();
second.set("file", new File([await textPdf([["Unindexed book about creed and synod"]])], "other.pdf", { type: "application/pdf" }));
second.set("title", `Unindexed fixture ${stamp}`);
await call("/api/milestone-one/files", { method: "POST", body: second });
const everything = (await call(`/api/search?mode=related&q=${encodeURIComponent("creed synod canon")}`)).body;
assert.equal(everything.method, "meaning");
assert.ok(everything.unindexed.some((title) => title.startsWith("Unindexed fixture")), "unindexed books are listed so results are not mistaken for complete");

// Remove the index: back to shared words
assert.equal((await call(`/api/embeddings?documentId=${documentId}`, { method: "DELETE" })).status, 200);
const afterRemove = (await call(`/api/search?mode=related&q=${encodeURIComponent("sacrament font")}&documentId=${documentId}`)).body;
assert.equal(afterRemove.method, "words");
console.log("Meaning index verified: fallback, build, incremental update, search, notes, unindexed warning, removal.");
