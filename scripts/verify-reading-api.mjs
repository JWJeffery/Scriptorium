// Live check of bookmarks and the per-document annotation export against a running server with MySQL.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const JSZip = createRequire(requireFromWeb.resolve("docx"))("jszip");
const call = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, response, body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
};
const send = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const form = new FormData();
form.set("file", new File([await textPdf([["One"], ["Two"], ["Three"], ["Four"]])], "reading.pdf", { type: "application/pdf" }));
form.set("title", "Reading fixture");
form.set("author", "Rae Reader");
const uploaded = (await call("/api/milestone-one/files", { method: "POST", body: form })).body;
const documentId = uploaded.document.id;

// --- bookmarks
assert.equal((await call("/api/bookmarks", send("POST", { documentId, pdfPage: 0 }))).status, 400);
assert.equal((await call("/api/bookmarks", send("POST", { documentId: "nope", pdfPage: 2 }))).status, 404);
const first = (await call("/api/bookmarks", send("POST", { documentId, pdfPage: 3 }))).body.bookmark;
await call("/api/bookmarks", send("POST", { documentId, pdfPage: 1, label: "Start" }));
const again = (await call("/api/bookmarks", send("POST", { documentId, pdfPage: 3, label: "Key chapter" }))).body.bookmark;
assert.equal(again.id, first.id, "marking a marked page updates it instead of duplicating");
const list = (await call(`/api/bookmarks?documentId=${documentId}`)).body.bookmarks;
assert.deepEqual(list.map((bookmark) => [bookmark.pdfPage, bookmark.label]), [[1, "Start"], [3, "Key chapter"]], "listed in page order");
assert.equal((await call(`/api/bookmarks?id=${first.id}`, { method: "DELETE" })).status, 200);
assert.equal((await call(`/api/bookmarks?documentId=${documentId}&pdfPage=1`, { method: "DELETE" })).status, 200);
assert.equal((await call(`/api/bookmarks?id=${first.id}`, { method: "DELETE" })).status, 404);
assert.equal((await call(`/api/bookmarks?documentId=${documentId}`)).body.bookmarks.length, 0);

// --- annotation export, in reading order
const annotate = (page, text, note, tags) => call("/api/milestone-one/annotations", send("POST", {
  documentId, versionId: uploaded.version.id, sourceId: uploaded.source.id, pageMapId: uploaded.pageMap.id,
  colorKey: "red", selectedText: text, note, tags, anchor: { selectedText: text, pageNumber: page, rects: [] },
  citationStyle: "sbl-note", citationText: `Rae Reader, Reading Fixture, ${page}.`, locatorValue: String(page)
}));
await annotate(3, "=HYPERLINK(\"http://evil.example\")", "formula-looking passage", ["risk"]);
await annotate(1, "Opening \"quoted\" words, with a comma", "first note", ["a", "b"]);

const csvBytes = Buffer.from(await (await fetch(`${baseUrl}/api/documents/export?documentId=${documentId}&format=csv`)).arrayBuffer());
assert.deepEqual([...csvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 byte-order mark so Excel reads accents and Greek");
const csv = csvBytes.subarray(3).toString("utf8");
assert.ok(csv.startsWith('"Book page"'));
const lines = csv.trim().split("\r\n");
assert.equal(lines.length, 3, "header plus two annotations");
assert.ok(lines[1].includes("\"Opening \"\"quoted\"\" words, with a comma\""), "quotes and commas are escaped; page 1 comes before page 3");
assert.ok(lines[2].includes("\"'=HYPERLINK("), "a passage that starts with = is neutralised so a spreadsheet will not run it");
assert.ok(lines[1].includes("a; b"), "tags are listed");

const md = await (await fetch(`${baseUrl}/api/documents/export?documentId=${documentId}&format=markdown`)).text();
assert.match(md, /^# Reading fixture: annotations/);
assert.ok(md.indexOf("Opening") < md.indexOf("formula-looking") || md.indexOf("Opening") < md.indexOf("HYPERLINK"), "reading order in Markdown");
assert.match(md, /\[\^1\]: Rae Reader, \*Reading Fixture\*/);

const docx = await fetch(`${baseUrl}/api/documents/export?documentId=${documentId}&format=docx`);
assert.equal(docx.status, 200);
const zip = await JSZip.loadAsync(Buffer.from(await docx.arrayBuffer()));
assert.ok((await zip.file("word/footnotes.xml").async("string")).includes("Rae Reader, "));

assert.equal((await call(`/api/documents/export?documentId=${documentId}&format=pdf`)).status, 400);
assert.equal((await call(`/api/documents/export?documentId=nope&format=csv`)).status, 404);
console.log("Reading API verified: bookmarks (idempotent, ordered, deletable) and annotation export (CSV safe for spreadsheets, Markdown, Word).");
