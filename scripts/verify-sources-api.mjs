// Live check of /api/sources/* (import, apply, validation) against a running server with MySQL.
// Lookups that reach outside websites are covered with simulated services in verify-source-lookup.mjs.
import assert from "node:assert/strict";
import { textPdf } from "./lib-test-pdf.mjs";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const call = async (path, body, method = "POST") => {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const form = new FormData();
form.set("file", new File([await textPdf([["Sources page"]])], "sources.pdf", { type: "application/pdf" }));
form.set("title", "Sources fixture");
form.set("author", "Ann Lee and Bob Ray");
const uploaded = await (await fetch(`${baseUrl}/api/milestone-one/files`, { method: "POST", body: form })).json();
const sourceId = uploaded.source.id;
const stored = (await (await fetch(`${baseUrl}/api/milestone-one/workspace?documentId=${uploaded.document.id}`)).json()).document.sources[0];
assert.deepEqual(stored.cslJson.author, [{ family: "Lee", given: "Ann" }, { family: "Ray", given: "Bob" }], "typed authors are saved as structured names");

assert.equal((await call("/api/sources/lookup", { query: "" })).status, 400);
assert.equal((await call("/api/sources/lookup", { query: "9780140449137" })).status, 400, "an ISBN with a wrong check digit is refused before any lookup");
assert.equal((await call("/api/sources/lookup", { query: "http://evil.example/x" })).status, 400, "web addresses are never fetched");

const imported = await call("/api/sources/import", { text: "@book{a, author={Sykes, Stephen W.}, title={The Integrity of Anglicanism}, publisher={A.R. Mowbray}, year={1978}}\n@book{b, author={Lee, Ann}, title={Another}, year={2001}}" });
assert.equal(imported.status, 200);
assert.equal(imported.body.entries.length, 2);
assert.equal((await call("/api/sources/import", { text: "not a bibliography at all" })).status, 400);
assert.equal((await call("/api/sources/import", {})).status, 400);

const applied = await call("/api/sources/apply", { sourceId, csl: imported.body.entries[0] }, "PUT");
assert.equal(applied.status, 200);
assert.equal(applied.body.source.shortTitle, "The Integrity of Anglicanism");
assert.equal((await call("/api/sources/apply", { sourceId: "nope", csl: imported.body.entries[0] }, "PUT")).status, 404);
assert.equal((await call("/api/sources/apply", { sourceId, csl: { author: [] } }, "PUT")).status, 400, "a record needs a title");

// The new record is what the citation engine now formats.
const cite = await call("/api/cite", { style: "sbl-note", items: [{ sourceId, locator: "12" }] });
assert.equal(cite.body.citations[0].text, "Stephen W. Sykes, The Integrity of Anglicanism (A.R. Mowbray, 1978), 12.");
assert.deepEqual(cite.body.missing, []);

// Saving the basic details form keeps richer fields that were set elsewhere.
await call("/api/sources/apply", { sourceId, csl: { ...imported.body.entries[0], edition: "2", "container-title": "A Series" } }, "PUT");
await call("/api/milestone-six/sources", { sourceId, title: "The Integrity of Anglicanism", author: "Stephen W. Sykes", place: "", publisher: "A.R. Mowbray", year: "1978" }, "PATCH");
const after = (await (await fetch(`${baseUrl}/api/milestone-one/workspace?documentId=${uploaded.document.id}`)).json()).document.sources[0].cslJson;
assert.equal(after.edition, "2", "editing basic details does not erase the edition");
assert.equal(after["container-title"], "A Series");

assert.equal((await call("/api/cite", { style: "nope", items: [{ csl: {} }] })).status, 400);
assert.equal((await call("/api/cite", { style: "sbl-note", items: [] })).status, 400);
assert.equal((await call("/api/cite", { style: "sbl-note", items: [{ sourceId: "missing" }] })).status, 404);

console.log("Sources API verified: structured authors, import, apply, citation from the new record, richer fields preserved, validation.");
