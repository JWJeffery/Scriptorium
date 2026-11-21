// Disaster-recovery check for the production stack, in two halves around a full wipe:
//   node scripts/verify-restore.mjs record <file>   adds a book with a highlight and remembers what it should look like
//   (back up with deploy/backup.sh, wipe every volume, restore with deploy/restore.sh)
//   node scripts/verify-restore.mjs check <file>    proves the book, its exact PDF bytes and its highlight came back
// Needs SCRIPTORIUM_BASE_URL, SCRIPTORIUM_AUTH_USER, SCRIPTORIUM_AUTH_PASSWORD.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { textPdf } from "./lib-test-pdf.mjs";

const [mode, file] = process.argv.slice(2);
assert.ok((mode === "record" || mode === "check") && file, "usage: verify-restore.mjs record|check <file>");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1";
const user = process.env.SCRIPTORIUM_AUTH_USER;
const password = process.env.SCRIPTORIUM_AUTH_PASSWORD;
assert.ok(user && password, "SCRIPTORIUM_AUTH_USER and SCRIPTORIUM_AUTH_PASSWORD are required");
const auth = { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
const call = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (mode === "record") {
  const stamp = Date.now();
  const pdf = await textPdf([[`Restore check ${stamp}.`, "Faith seeking understanding."], ["Second page."]]);
  const form = new FormData();
  form.set("file", new File([pdf], "restore-check.pdf", { type: "application/pdf" }));
  form.set("title", `Restore check ${stamp}`);
  const uploaded = await call("/api/core/files?allowDuplicate=true", { method: "POST", body: form });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const body = await uploaded.json();
  const highlight = `Faith seeking understanding (${stamp})`;
  const saved = await call("/api/core/annotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: body.document.id, versionId: body.version.id, sourceId: body.source.id, pageMapId: body.pageMap.id,
      colorKey: "yellow", selectedText: highlight, note: "Must survive a restore.", tags: ["restore-check"],
      anchor: { selectedText: highlight, pageNumber: 1, rects: [] },
      citationStyle: "sbl-note", citationText: `Restore check ${stamp}, 1.`, locatorValue: "1"
    })
  });
  assert.ok(saved.ok, `highlight saved: ${saved.status} ${await saved.text()}`);
  writeFileSync(file, JSON.stringify({ documentId: body.document.id, title: `Restore check ${stamp}`, sha256: sha(pdf), highlight }));
  console.log(`Recorded a book (${body.document.id}) with a highlight, ready for the backup.`);
} else {
  const expected = JSON.parse(readFileSync(file, "utf8"));
  const item = await call(`/api/v1/items/${expected.documentId}`);
  assert.equal(item.status, 200, `the book is back after the restore (${item.status})`);
  const pdf = await call(`/api/core/files/${expected.documentId}`);
  assert.equal(pdf.status, 200, `its PDF file is back (${pdf.status})`);
  assert.equal(sha(Buffer.from(await pdf.arrayBuffer())), expected.sha256, "the PDF is byte-for-byte the original");
  const annotations = await (await call(`/api/v1/items/${expected.documentId}/annotations`)).json();
  const found = annotations.annotations?.find((row) => row.selectedText === expected.highlight);
  assert.ok(found, "the highlight is back");
  assert.equal(found.note, "Must survive a restore.", "with its note");
  assert.deepEqual(found.tags, ["restore-check"], "and its tag");
  console.log("Restore verified: the book, its exact PDF and its highlight (note and tag) came back from the backup.");
}
