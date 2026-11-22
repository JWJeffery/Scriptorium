// Unit check of what the browser keeps of highlights (apps/web/lib/reader-model.ts): only the open book's and anything
// not yet in the database, and running out of storage never throws.
//   node --experimental-strip-types scripts/verify-annotation-storage.mjs
import assert from "node:assert/strict";

const store = new Map();
let capacity = Infinity;
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { if (String(value).length > capacity) { const error = new Error("QuotaExceededError"); error.name = "QuotaExceededError"; throw error; } store.set(key, String(value)); },
  removeItem: (key) => store.delete(key)
};
const { annotationsWorthKeeping, writeAnnotationCopy } = await import("../apps/web/lib/annotation-storage.ts");
const KEY = "annotations";
const saveAnnotations = (records) => writeAnnotationCopy(localStorage, KEY, records, open);
const readAnnotations = () => JSON.parse(localStorage.getItem(KEY) ?? "[]");

const open = { id: "doc-open", title: "Open", filename: "a.pdf", kind: "PDF", mediaType: "application/pdf", size: 1, source: { author: "", title: "", place: "", publisher: "", year: "" }, pageMap: { basePdfPageIndex: 1, baseBookPage: 1, currentPdfPageIndex: 1 }, server: { documentId: "doc-open", versionId: "v-open", sourceId: "s", pageMapId: "p" } };
const rec = (id, documentId, extra = {}) => ({ id, documentId, colorKey: "yellow", selectedText: "x".repeat(200), note: "", pdfPageIndex: 1, bookPageLabel: "1", citationStyle: "sbl-note", citationText: "", createdAt: "2026-01-01", ...extra });
const records = [
  rec("mine", "doc-open", { serverAnnotationId: "a1", versionId: "v-open" }),
  rec("other-synced", "doc-other", { serverAnnotationId: "a2", versionId: "v-other" }),
  rec("other-unsent", "doc-other"),
  rec("other-edit", "doc-other", { serverAnnotationId: "a3", pendingEdit: true })
];
assert.deepEqual(annotationsWorthKeeping(records, open).map((r) => r.id), ["mine", "other-unsent", "other-edit"], "keeps the open book's and unsent work only");
assert.equal(saveAnnotations(records), true);
assert.deepEqual(readAnnotations().map((r) => r.id), ["mine", "other-unsent", "other-edit"]);

// Storage nearly full: the open book's synced highlight is dropped before any unsent work.
capacity = JSON.stringify(records.filter((r) => r.id !== "mine" && r.id !== "other-synced")).length + 5;
assert.equal(saveAnnotations(records), true, "a smaller copy fits");
assert.deepEqual(readAnnotations().map((r) => r.id), ["other-unsent", "other-edit"], "unsent work is what is kept");
// Storage completely full: no exception, just a warning.
capacity = 0;
const warn = console.warn; console.warn = () => {};
assert.equal(saveAnnotations(records), false, "full storage does not throw");
console.warn = warn;
console.log("Browser highlight storage verified: only the open book and unsent work are kept, and a full storage never throws.");
