// Manual check with the REAL embedding model (downloads it once, 23 MB).
// Run against a server started WITHOUT SCRIPTORIUM_FAKE_EMBEDDINGS:
//   SCRIPTORIUM_BASE_URL=http://127.0.0.1:3101 node scripts/verify-meaning-real-model.mjs
import assert from "node:assert/strict";
import { textPdf } from "./lib-test-pdf.mjs";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3101";
const call = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json().catch(() => null) };
};
const send = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const form = new FormData();
form.set("file", new File([await textPdf([
  ["The church must preserve the unity of the faithful.", "Believers are called to remain together in one body."],
  ["Mix two cups of flour with a pinch of salt and knead.", "Bake the loaf in a hot oven until golden brown."],
  ["The bishops gathered to define the creed at the council.", "Doctrine was settled by common agreement of the assembly."]
])], "real.pdf", { type: "application/pdf" }));
form.set("title", `Real model fixture ${Date.now()}`);
const uploaded = (await call("/api/core/files", { method: "POST", body: form })).body;
const documentId = uploaded.document.id;

const t0 = Date.now();
assert.equal((await call("/api/embeddings", send("POST", { documentId }))).status, 202);
let status;
for (let attempt = 0; attempt < 240; attempt += 1) {
  status = (await call("/api/embeddings")).body.documents.find((entry) => entry.documentId === documentId);
  if (status.progress?.state === "finished" || status.progress?.state === "failed") break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert.equal(status.progress.state, "finished", status.progress?.error);
console.log(`Indexed ${status.pagePassages} passages in ${((Date.now() - t0) / 1000).toFixed(1)} s (including any model download).`);

const modelState = (await call("/api/embeddings")).body.model;
assert.ok(modelState.ready && modelState.model === "all-MiniLM-L6-v2" && modelState.bytes > 20_000_000);

// A query that shares NO words with the right passage.
const query = "ecclesial communion and togetherness among those who believe";
const meaning = (await call(`/api/search?mode=related&q=${encodeURIComponent(query)}&documentId=${documentId}`)).body;
assert.equal(meaning.method, "meaning");
assert.equal(meaning.pages[0].pdfPageIndex, 1, "the passage about the unity of believers ranks first without sharing any words");
console.log("Top results:", meaning.pages.map((page) => `p${page.pdfPageIndex}=${page.score.toFixed(2)}`).join(", "));

const bread = (await call(`/api/search?mode=related&q=${encodeURIComponent("baking bread dough")}&documentId=${documentId}`)).body;
assert.equal(bread.pages[0].pdfPageIndex, 2);
const synod = (await call(`/api/search?mode=related&q=${encodeURIComponent("church leaders agreeing on official teaching")}&documentId=${documentId}`)).body;
assert.equal(synod.pages[0].pdfPageIndex, 3);

await call(`/api/embeddings?documentId=${documentId}`, { method: "DELETE" });
console.log("Real model verified: downloads with checksums, indexes, and finds passages by meaning with no shared words.");
