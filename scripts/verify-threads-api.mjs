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
const uploaded = (await call("/api/milestone-one/files", { method: "POST", body: form })).body;
const annotation = (await call("/api/milestone-one/annotations", jsonInit("POST", {
  documentId: uploaded.document.id, versionId: uploaded.version.id, sourceId: uploaded.source.id, pageMapId: uploaded.pageMap.id,
  colorKey: "green", selectedText: "On the unity of the church.", note: "Key claim", tags: [],
  anchor: { selectedText: "On the unity of the church.", pageNumber: 1, rects: [] },
  citationStyle: "sbl-note", citationText: "Ada Lovelace, Thread fixture book, 1.", locatorValue: "1"
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

const withNote = (await call("/api/threads/items", jsonInit("POST", { threadId, itemType: "NOTE", note: "My own connecting paragraph." }))).body.thread;
assert.equal(withNote.items.length, 2);
const [first, second] = withNote.items;

const reordered = (await call("/api/threads/items", jsonInit("PATCH", { threadId, order: [second.id, first.id] }))).body.thread;
assert.equal(reordered.items[0].id, second.id, "reorder changes the order");
assert.equal((await call("/api/threads/items", jsonInit("PATCH", { threadId, order: [second.id] }))).status, 400, "reorder must list every item");

const noted = (await call("/api/threads/items", jsonInit("PATCH", { threadId, itemId: first.id, note: "Use this in chapter 2" }))).body.thread;
assert.equal(noted.items.find((item) => item.id === first.id).note, "Use this in chapter 2");

const markdown = await call(`/api/threads/export?threadId=${threadId}&format=markdown`);
const mdText = await markdown.response.text();
assert.match(mdText, /^# Unity of the church/);
assert.match(mdText, /> On the unity of the church\.\[\^1\]/);
assert.match(mdText, /\[\^1\]: Ada Lovelace, Thread fixture book, 1\./);
assert.match(mdText, /My own connecting paragraph\./);

const docx = await fetch(`${baseUrl}/api/threads/export?threadId=${threadId}&format=docx`);
assert.equal(docx.status, 200);
const zip = await JSZip.loadAsync(Buffer.from(await docx.arrayBuffer()));
const footnotes = await zip.file("word/footnotes.xml").async("string");
assert.ok(footnotes.includes("Ada Lovelace, Thread fixture book, 1."), "the Word file carries a real footnote");
const body = await zip.file("word/document.xml").async("string");
assert.ok(body.includes("On the unity of the church.") && body.includes("w:footnoteReference"), "the quoted passage points at its footnote");
assert.equal((await call(`/api/threads/export?threadId=${threadId}&format=pdf`)).status, 400);

const removed = (await call(`/api/threads/items?threadId=${threadId}&itemId=${first.id}`, { method: "DELETE" })).body.thread;
assert.equal(removed.items.length, 1);
assert.equal(removed.items[0].orderIndex, 0, "order is re-numbered after a removal");

// A deleted annotation leaves a marked gap instead of breaking the thread.
await call(`/api/milestone-one/annotations?annotationId=${annotation.id}`, { method: "DELETE" });
const list = (await call("/api/threads")).body.threads;
assert.ok(list.find((thread) => thread.id === threadId && thread.itemCount === 1));

const renamed = (await call("/api/threads", jsonInit("PATCH", { threadId, title: "Renamed thread", tags: ["only"] }))).body.thread;
assert.equal(renamed.title, "Renamed thread");
assert.deepEqual(renamed.tags, ["only"]);
assert.equal((await call(`/api/threads?threadId=${threadId}`, { method: "DELETE" })).status, 200);
assert.equal((await call(`/api/threads?threadId=${threadId}`)).status, 404);

console.log("Threads API verified: create, collect, de-duplicate, reorder, notes, Markdown and Word (real footnotes) export, delete.");
