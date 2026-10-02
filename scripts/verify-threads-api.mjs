// Live check of /api/threads against a running server with MySQL.
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
const jsonInit = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// A document with one saved annotation to collect.
const form = new FormData();
form.set("file", new File([await textPdf([["Chapter one", "On the unity of the church."]])], "thread-fixture.pdf", { type: "application/pdf" }));
form.set("title", "Thread fixture book");
form.set("author", "Ada Lovelace");
const uploaded = (await call("/api/core/files", { method: "POST", body: form })).body;
const annotation = (await call("/api/core/annotations", jsonInit("POST", {
  documentId: uploaded.document.id, versionId: uploaded.version.id, sourceId: uploaded.source.id, pageMapId: uploaded.pageMap.id,
  colorKey: "green", selectedText: "On the unity of the church.", note: "Key claim", tags: [],
  anchor: { selectedText: "On the unity of the church.", pageNumber: 1, rects: [] },
  citationStyle: "sbl-note", citationText: "Ada Lovelace, Thread fixture book, 1.", locatorValue: "1"
}))).body.annotation;

const second = (await call("/api/core/annotations", jsonInit("POST", {
  documentId: uploaded.document.id, versionId: uploaded.version.id, sourceId: uploaded.source.id, pageMapId: uploaded.pageMap.id,
  colorKey: "blue", selectedText: "A second passage.", note: "", tags: [],
  anchor: { selectedText: "A second passage.", pageNumber: 1, rects: [] },
  citationStyle: "sbl-note", citationText: "Ada Lovelace, Thread fixture book, 7.", locatorValue: "7"
}))).body.annotation;

assert.equal((await call("/api/threads", jsonInit("POST", { title: "" }))).status, 400, "a thread needs a title");
assert.equal((await call("/api/threads", { method: "POST", headers: { "content-type": "application/json" }, body: "not json" })).status, 400);

const created = (await call("/api/threads", jsonInit("POST", { title: "Unity of the church", description: "Collected passages", tags: ["ecclesiology", "unity"] }))).body.thread;
assert.deepEqual(created.tags.sort(), ["ecclesiology", "unity"]);
const threadId = created.id;

const added = (await call("/api/threads/items", jsonInit("POST", { threadId, itemType: "ANNOTATION", itemId: annotation.id }))).body;
assert.equal(added.thread.items.length, 1);
assert.equal(added.thread.items[0].context.selectedText, "On the unity of the church.");
assert.equal(added.thread.items[0].context.bookPage, "1");
const again = (await call("/api/threads/items", jsonInit("POST", { threadId, itemType: "ANNOTATION", itemId: annotation.id }))).body;
assert.equal(again.alreadyPresent, true);
assert.equal(again.thread.items.length, 1, "adding the same item twice does not duplicate");
assert.equal((await call("/api/threads/items", jsonInit("POST", { threadId, itemType: "ANNOTATION", itemId: "nope" }))).status, 404);

await call("/api/threads/items", jsonInit("POST", { threadId, itemType: "ANNOTATION", itemId: second.id }));
const withNote = (await call("/api/threads/items", jsonInit("POST", { threadId, itemType: "NOTE", note: "My own connecting paragraph." }))).body.thread;
assert.equal(withNote.items.length, 3);
const [first, quoteTwo, paragraph] = withNote.items;

const reordered = (await call("/api/threads/items", jsonInit("PATCH", { threadId, order: [paragraph.id, first.id, quoteTwo.id] }))).body.thread;
assert.equal(reordered.items[0].id, paragraph.id, "reorder changes the order");
assert.equal((await call("/api/threads/items", jsonInit("PATCH", { threadId, order: [paragraph.id] }))).status, 400, "reorder must list every item");

const noted = (await call("/api/threads/items", jsonInit("PATCH", { threadId, itemId: first.id, note: "Use this in chapter 2" }))).body.thread;
assert.equal(noted.items.find((item) => item.id === first.id).note, "Use this in chapter 2");

const markdown = await call(`/api/threads/export?threadId=${threadId}&format=markdown`);
const mdText = await markdown.response.text();
assert.match(mdText, /^# Unity of the church/);
assert.match(mdText, /> On the unity of the church\.\[\^1\]/);
assert.match(mdText, /\[\^1\]: Ada Lovelace, \*Thread Fixture Book\*, n\.d\., 1\./, "first footnote is in full, title in italics");
assert.match(mdText, /\[\^2\]: Lovelace, \*Thread Fixture Book\*, 7\./, "a repeat reference is shortened by the citation style");
assert.match(mdText, /## Bibliography\n\n- Lovelace, Ada\. \*Thread Fixture Book\*/, "the sources used are listed in a bibliography");
assert.match(mdText, /My own connecting paragraph\./);

const docx = await fetch(`${baseUrl}/api/threads/export?threadId=${threadId}&format=docx`);
assert.equal(docx.status, 200);
const zip = await JSZip.loadAsync(Buffer.from(await docx.arrayBuffer()));
const footnotes = await zip.file("word/footnotes.xml").async("string");
assert.ok(footnotes.includes("Ada Lovelace, ") && footnotes.includes("Thread Fixture Book") && footnotes.includes("Lovelace, "), "the Word file carries real footnotes");
assert.ok(/<w:i\/?>/.test(footnotes), "the title is italic in the footnote");
const body = await zip.file("word/document.xml").async("string");
assert.ok(body.includes("On the unity of the church.") && body.includes("w:footnoteReference"), "the quoted passage points at its footnote");
assert.equal((await call(`/api/threads/export?threadId=${threadId}&format=pdf`)).status, 400);

const chicago = await (await fetch(`${baseUrl}/api/threads/export?threadId=${threadId}&format=markdown&style=chicago-note`)).text();
assert.match(chicago, /\[\^1\]: Ada Lovelace, \*Thread Fixture Book\* \(n\.d\.\), 1\./, "Chicago and SBL differ, and the style chosen for the export decides");

const removed = (await call(`/api/threads/items?threadId=${threadId}&itemId=${first.id}`, { method: "DELETE" })).body.thread;
assert.equal(removed.items.length, 2);
assert.deepEqual(removed.items.map((item) => item.orderIndex), [0, 1], "order is re-numbered after a removal");

// A deleted annotation leaves a marked gap instead of breaking the thread.
await call(`/api/core/annotations?annotationId=${annotation.id}`, { method: "DELETE" });
await call(`/api/core/annotations?annotationId=${second.id}`, { method: "DELETE" });
const list = (await call("/api/threads")).body.threads;
assert.ok(list.find((thread) => thread.id === threadId && thread.itemCount === 2));

const renamed = (await call("/api/threads", jsonInit("PATCH", { threadId, title: "Renamed thread", tags: ["only"] }))).body.thread;
assert.equal(renamed.title, "Renamed thread");
assert.deepEqual(renamed.tags, ["only"]);
assert.equal((await call(`/api/threads?threadId=${threadId}`, { method: "DELETE" })).status, 200);
assert.equal((await call(`/api/threads?threadId=${threadId}`)).status, 404);

console.log("Threads API verified: create, collect, de-duplicate, reorder, notes, Markdown and Word (real footnotes) export, delete.");
