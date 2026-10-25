// Live check of the Library API (/api/v1/items, collections, saved searches, progress, soft delete,
// duplicate detection) against a running server and PostgreSQL.
import assert from "node:assert/strict";
import { textPdf } from "./lib-test-pdf.mjs";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const call = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, response, body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
};
const send = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const stamp = Date.now();

async function upload(label, { author, allowDuplicate = false, pages } = {}) {
  const form = new FormData();
  form.set("file", new File([await textPdf(pages ?? [[`${label} ${stamp} first page`], [`${label} second page`]])], `${label}.pdf`, { type: "application/pdf" }));
  form.set("title", `${label} ${stamp}`);
  if (author) form.set("author", author);
  return call(`/api/core/files${allowDuplicate ? "?allowDuplicate=true" : ""}`, { method: "POST", body: form });
}
const idsOf = (result) => result.body.items.map((item) => item.id);

// --- upload and duplicates
const a = await upload("Library A", { author: "Ann Author" });
const b = await upload("Library B");
assert.equal(a.status, 201);
assert.equal(b.status, 201);
const aId = a.body.document.id;
const bId = b.body.document.id;
const again = await upload("Library A", { author: "Ann Author", pages: [[`Library A ${stamp} first page`], ["Library A second page"]] });
assert.equal(again.status, 409, "the same file twice is refused by default");
assert.equal(again.body.code, "duplicate");
assert.equal(again.body.duplicateOf.documentId, aId);
const allowed = await upload("Library A", { author: "Ann Author", allowDuplicate: true, pages: [[`Library A ${stamp} first page`], ["Library A second page"]] });
assert.equal(allowed.status, 201, "the user can add it anyway");
const a2Id = allowed.body.document.id;
const digest = (await call(`/api/v1/items/${aId}`)).body.preservation.checksum;
assert.match(digest, /^[0-9a-f]{64}$/);
assert.equal((await call(`/api/v1/items/by-checksum?sha256=${digest}`)).body.item.id, aId, "lookup by checksum finds the first copy");
assert.equal((await call(`/api/v1/items/by-checksum?sha256=${"0".repeat(64)}`)).body.item, null);
assert.equal((await call("/api/v1/items/by-checksum?sha256=nothex")).status, 400);
const groups = (await call("/api/v1/items/duplicates")).body.groups;
assert.ok(groups.some((group) => group.items.some((item) => item.id === aId) && group.items.some((item) => item.id === a2Id)), "both copies are reported as duplicates");

// --- defaults, standard errors
const first = (await call(`/api/v1/items/${bId}`)).body;
assert.equal(first.state, "read_later", "new items start in Read later");
assert.equal(first.favorite, false);
assert.equal(first.version, "0");
const missing = await call("/api/v1/items/does-not-exist");
assert.equal(missing.status, 404);
assert.equal(missing.body.code, "not_found");
assert.equal(typeof missing.body.requestId, "string");
assert.equal(missing.body.retryable, false);

// --- editing state, favorite, tags; conflicts and validation
const edited = await call(`/api/v1/items/${aId}`, send("PATCH", { state: "reading", favorite: true, tags: ["Ecclesiology", "  Episcopacy ", "ecclesiology"] }));
assert.equal(edited.status, 200);
assert.equal(edited.body.state, "reading");
assert.equal(edited.body.favorite, true);
assert.deepEqual(edited.body.tags, ["ecclesiology", "episcopacy"], "tags are normalised and de-duplicated");
assert.equal(edited.body.version, "1");
const stale = await call(`/api/v1/items/${aId}`, send("PATCH", { state: "archived", baseVersion: "0" }));
assert.equal(stale.status, 409, "an edit based on an old version is refused");
assert.equal(stale.body.code, "conflict");
assert.equal(stale.body.currentVersion, "1");
assert.equal((await call(`/api/v1/items/${aId}`, send("PATCH", { state: "reading", baseVersion: "1" }))).status, 200, "an edit based on the current version is accepted");
const bad = await call(`/api/v1/items/${aId}`, send("PATCH", { state: "bogus" }));
assert.equal(bad.status, 400);
assert.equal(bad.body.code, "invalid_request");
assert.ok(bad.body.fieldErrors.state, "the failing field is named");
assert.equal((await call(`/api/v1/items/${aId}`, send("PATCH", { surprise: true }))).status, 400, "unknown properties are rejected");

// --- views, filters, pagination
const reading = idsOf(await call("/api/v1/items?view=reading&limit=100"));
assert.ok(reading.includes(aId) && !reading.includes(bId));
assert.ok(idsOf(await call("/api/v1/items?view=read_later&limit=100")).includes(bId));
assert.ok(idsOf(await call("/api/v1/items?view=favorites&limit=100")).includes(aId));
assert.ok(idsOf(await call(`/api/v1/items?q=${encodeURIComponent(`library b ${stamp}`)}`)).includes(bId), "title search ignores case");
assert.deepEqual(idsOf(await call("/api/v1/items?tag=EPISCOPACY&limit=100")).filter((id) => [aId, bId, a2Id].includes(id)), [aId], "tag filter ignores case");
const missingMetadata = idsOf(await call("/api/v1/items?view=missing_metadata&limit=100"));
assert.ok(missingMetadata.includes(bId) && !missingMetadata.includes(aId), "items without an author are flagged for metadata review");
const seen = [];
let cursor = null;
let pages = 0;
do {
  const page = await call(`/api/v1/items?limit=5${cursor ? `&cursor=${cursor}` : ""}`);
  assert.equal(page.status, 200);
  assert.ok(page.body.items.length <= 5);
  seen.push(...idsOf(page));
  cursor = page.body.nextCursor;
  pages += 1;
  assert.ok(pages < 50, "pagination terminates");
} while (cursor);
assert.equal(new Set(seen).size, seen.length, "no item appears twice across pages");
assert.ok([aId, bId, a2Id].every((id) => seen.includes(id)), "every item appears once pages are followed to the end");
assert.equal((await call("/api/v1/items?cursor=garbage")).body.code, "invalid_cursor");

// --- collections: many-to-many, no copies
const dissertation = await call("/api/v1/collections", send("POST", { name: `Dissertation ${stamp}`, description: "chapters" }));
assert.equal(dissertation.status, 201);
assert.equal((await call("/api/v1/collections", send("POST", { name: `dissertation ${stamp}` }))).status, 409, "collection names are unique ignoring case");
const ecclesiology = (await call("/api/v1/collections", send("POST", { name: `Ecclesiology ${stamp}` }))).body;
const d = dissertation.body.id;
assert.deepEqual((await call(`/api/v1/collections/${d}/items`, send("POST", { itemIds: [aId, bId, "ghost"] }))).body, { added: 2, alreadyMembers: 0, missing: ["ghost"] });
assert.equal((await call(`/api/v1/collections/${d}/items`, send("POST", { itemIds: [aId, bId] }))).body.alreadyMembers, 2, "adding twice does not duplicate");
await call(`/api/v1/collections/${ecclesiology.id}/items`, send("POST", { itemIds: [aId] }));
const withCollections = (await call(`/api/v1/items/${aId}`)).body;
assert.deepEqual(withCollections.collections.map((collection) => collection.id).sort(), [d, ecclesiology.id].sort(), "one item, two collections, no copy");
assert.deepEqual(idsOf(await call(`/api/v1/items?collectionId=${d}&limit=100`)).sort(), [aId, bId].sort());
assert.equal((await call("/api/v1/collections")).body.collections.find((collection) => collection.id === d).itemCount, 2);
assert.equal((await call(`/api/v1/collections/${d}/items`, { ...send("DELETE", { itemIds: [bId] }) })).body.removed, 1);
assert.deepEqual(idsOf(await call(`/api/v1/items?collectionId=${d}&limit=100`)), [aId]);
const renamed = await call(`/api/v1/collections/${d}`, send("PATCH", { name: `Dissertation chapters ${stamp}` }));
assert.equal(renamed.body.name, `Dissertation chapters ${stamp}`);
assert.equal((await call(`/api/v1/collections/${ecclesiology.id}`, { method: "DELETE" })).body.itemsKept, 1);
assert.equal((await call(`/api/v1/items/${aId}`)).status, 200, "deleting a collection never deletes its items");

// --- progress is kept on the server and never touches the editing version
const beforeProgress = (await call(`/api/v1/items/${bId}`)).body;
assert.equal(beforeProgress.state, "read_later");
await call(`/api/v1/items/${bId}/progress`, send("POST", { page: 5, pageCount: 10 }));
const afterProgress = (await call(`/api/v1/items/${bId}`)).body;
assert.deepEqual([afterProgress.progress.lastPage, afterProgress.progress.pageCount, afterProgress.progress.percent], [5, 10, 50]);
assert.equal(afterProgress.state, "reading", "opening a book moves it from Read later to Reading");
assert.equal(afterProgress.version, beforeProgress.version, "reading progress does not count as an edit");
assert.ok(afterProgress.lastOpenedAt);
await call(`/api/v1/items/${bId}`, send("PATCH", { state: "archived" }));
await call(`/api/v1/items/${bId}/progress`, send("POST", { page: 6 }));
assert.equal((await call(`/api/v1/items/${bId}`)).body.state, "archived", "progress never pulls an archived book back");
assert.equal((await call(`/api/v1/items/${bId}/progress`, send("POST", { page: 0 }))).status, 400);

// --- annotations, recently annotated, delete impact, soft delete, restore
const annotation = await call("/api/core/annotations", send("POST", {
  documentId: aId, versionId: a.body.version.id, sourceId: a.body.source.id, pageMapId: a.body.pageMap.id,
  colorKey: "red", selectedText: "first page", note: "kept", tags: [], anchor: { selectedText: "first page", pageNumber: 1, rects: [] },
  citationStyle: "sbl-note", citationText: "Ann Author, Library A, 1.", locatorValue: "1"
}));
assert.equal(annotation.status, 201);
assert.equal(idsOf(await call("/api/v1/items?view=recently_annotated&limit=1"))[0], aId, "the most recently annotated book comes first");
const impact = (await call(`/api/v1/items/${aId}/impact`)).body;
assert.deepEqual([impact.annotations, impact.citations, impact.collections, impact.files], [1, 1, 1, 1]);
assert.equal((await call(`/api/v1/items/${aId}`, { method: "DELETE" })).status, 200);
assert.ok(!idsOf(await call("/api/v1/items?limit=100")).includes(aId), "a deleted item leaves the library");
assert.ok(idsOf(await call("/api/v1/items?view=deleted&limit=100")).includes(aId), "and appears under Deleted");
assert.ok(!(await call("/api/core/library")).body.documents.some((entry) => entry.documentId === aId), "the Open saved list hides it too");
const search = await call(`/api/search?q=${encodeURIComponent(`library a ${stamp} first`)}`);
assert.ok(!JSON.stringify(search.body).includes(aId), "search does not return a deleted book");
assert.equal((await call(`/api/v1/items/${aId}`, { method: "DELETE" })).status, 404, "deleting twice is a clean not-found");
const restored = await call(`/api/v1/items/${aId}/restore`, { method: "POST" });
assert.equal(restored.status, 200);
assert.equal(restored.body.state, "reading", "restoring keeps the state it had");
assert.equal(restored.body.annotationCount, 1, "and keeps its annotations");
assert.ok(idsOf(await call("/api/v1/items?limit=100")).includes(aId));

// --- saved searches are dynamic
const saved = await call("/api/v1/saved-searches", send("POST", { name: `Active ${stamp}`, query: { view: "reading" } }));
assert.equal(saved.status, 201);
assert.ok(idsOf(await call(`/api/v1/items?savedSearchId=${saved.body.id}&limit=100`)).includes(aId));
await call(`/api/v1/items/${aId}`, send("PATCH", { state: "archived" }));
assert.ok(!idsOf(await call(`/api/v1/items?savedSearchId=${saved.body.id}&limit=100`)).includes(aId), "a saved search re-runs every time it is opened");
assert.equal((await call("/api/v1/saved-searches", send("POST", { name: "x", query: { view: "nonsense" } }))).status, 400);
assert.equal((await call(`/api/v1/saved-searches/${saved.body.id}`, { method: "DELETE" })).status, 200);
assert.equal((await call(`/api/v1/saved-searches/${saved.body.id}`, { method: "DELETE" })).status, 404);

console.log("Library API verified: duplicates, states, tags, conflicts, views, cursors, collections, progress, soft delete and restore, saved searches.");
