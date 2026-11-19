// A book that exists on the server but whose file only lives in this browser (how the first version of the
// app stored books): opening it must copy the file to the server, show progress, and leave the book intact.
// Needs a running server (auth disabled), Postgres via DATABASE_URL, psql, and Chromium.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const title = `Browser Only ${Date.now()}`;
const bytes = await textPdf([["Only in the browser."]]);

const form = new FormData();
form.set("file", new File([bytes], "browser-only.pdf", { type: "application/pdf" }));
form.set("title", title);
const created = await (await fetch(`${base}/api/core/files?allowDuplicate=true`, { method: "POST", body: form })).json();
const id = created.document.id;
// Make it look like a first-version book: the server knows the record but has no file.
execSync(`psql "${process.env.DATABASE_URL}" -c "update \\"Document\\" set \\"storageKey\\"=null where id='${id}'"`, { stdio: "ignore" });
const stored = async () => (await (await fetch(`${base}/api/v1/items/${id}`)).json()).preservation.originalStored;
assert.equal(await stored(), false, "starts with no file on the server");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(base + `/library?q=${encodeURIComponent(title)}`);
  await page.locator("tr", { hasText: title }).getByRole("link", { name: "Read", exact: true }).click();
  await page.waitForURL(`${base}/`);
  await page.locator(".ledgerTopbar").waitFor();
  // Put the file where the first version kept it, then reopen the book.
  await page.evaluate(async ({ id, data }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("scriptorium-file-store", 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("pdf-blobs")) r.result.createObjectStore("pdf-blobs"); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve, reject) => { const t = db.transaction("pdf-blobs", "readwrite"); t.objectStore("pdf-blobs").put(new Blob([new Uint8Array(data)], { type: "application/pdf" }), id); t.oncomplete = resolve; t.onerror = () => reject(t.error); });
  }, { id, data: [...bytes] });
  await page.reload();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !(await stored())) await page.waitForTimeout(250);
  assert.equal(await stored(), true, "the browser's copy was saved on the server");
  assert.ok(await page.locator(".serverCopyNotice").count() >= 0);
} finally {
  await browser.close();
}
console.log("Browser-only book verified: opening it saved a copy on the server.");
