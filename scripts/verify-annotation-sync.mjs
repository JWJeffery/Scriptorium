import assert from "node:assert/strict";
import { mergeServerRecords, belongsToScope } from "../apps/web/lib/annotation-sync.ts";

const rec = (id, extra = {}) => ({ id, documentId: "local-doc", versionId: "v1", createdAt: `2026-01-0${id.slice(-1)}T00:00:00Z`, note: "", ...extra });
const scope = { versionIds: new Set(["v1"]), localDocumentIds: new Set(["local-doc"]) };

// Browser holds: a (synced), b (synced, since deleted on the server), c (never reached the server), other (another book)
const local = [rec("a1", { serverAnnotationId: "S1", note: "old" }), rec("b2", { serverAnnotationId: "S2" }), rec("c3"), rec("o4", { documentId: "other", versionId: "v9", serverAnnotationId: "S9" })];
// Server has: S1 (edited elsewhere), S5 (new, made on another device)
const fetched = [rec("server_S1", { serverAnnotationId: "S1", note: "edited elsewhere" }), rec("server_S5", { serverAnnotationId: "S5", createdAt: "2026-01-05T00:00:00Z" })];

const result = mergeServerRecords(local, fetched, scope);
assert.equal(result.added, 1, "a record made elsewhere appears");
assert.equal(result.updated, 1);
assert.equal(result.removed, 1, "a record deleted elsewhere disappears");
assert.equal(result.unsaved, 1, "a record the server never got is kept and counted");
const byId = Object.fromEntries(result.records.map((record) => [record.id, record]));
assert.equal(byId.a1.note, "edited elsewhere", "the database's version wins, keeping the local id");
assert.equal(byId.a1.id, "a1");
assert.ok(!byId.b2, "deleted record is gone");
assert.ok(byId.c3 && !byId.c3.serverAnnotationId, "unsaved record kept");
assert.ok(byId.o4, "another book's records are untouched");
assert.ok(byId.server_S5);
assert.deepEqual(result.records.map((record) => record.id), ["server_S5", "c3", "a1", "o4"].sort((x, y) => byId[y].createdAt.localeCompare(byId[x].createdAt)), "newest first");

// A record without a version id belongs by its local document id
assert.equal(belongsToScope({ id: "x", documentId: "local-doc", createdAt: "" }, scope), true);
assert.equal(belongsToScope({ id: "x", documentId: "elsewhere", createdAt: "" }, scope), false);

// An empty server answer clears synced records but not unsaved ones
const none = mergeServerRecords(local, [], scope);
assert.deepEqual(none.records.map((record) => record.id).sort(), ["c3", "o4"]);
console.log("Annotation sync verified: database wins, deletions propagate, unsaved work is kept, other books untouched.");
