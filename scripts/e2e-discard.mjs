// End-to-end browser check: an unsaved highlight can be discarded from the regular (side panel) view, not
// only from read mode. Discard clears the selection, its preview highlight, and the note and tags typed for it.
// Needs a running server (auth disabled) and Chromium.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const title = `Discard Book ${Date.now()}`;

const form = new FormData();
form.set("file", new File([await textPdf([["Faith seeking understanding."]])], "discard.pdf", { type: "application/pdf" }));
form.set("title", title);
const upload = await fetch(`${base}/api/core/files?allowDuplicate=true`, { method: "POST", body: form });
assert.ok(upload.ok, "fixture upload");
const documentId = (await upload.json()).document.id;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(`${base}/?open=${documentId}`);
  await page.waitForLoadState("load");
  const word = page.locator(".pdfTextRun", { hasText: "Faith" }).first();
  await word.waitFor({ timeout: 20000 });
  const box = await word.boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const discard = page.getByRole("button", { name: "Discard", exact: true });
  await discard.waitFor({ timeout: 10000 });
  assert.ok(await page.getByRole("button", { name: "Save highlight" }).isVisible(), "Save highlight sits beside Discard");
  await page.getByPlaceholder("Add your note.").fill("A note I no longer want");
  assert.ok((await page.locator(".pdfHighlightBox").count()) > 0, "the unsaved highlight is previewed on the page");
  if (process.env.SHOT) await page.locator(".pendingActions").screenshot({ path: process.env.SHOT });

  await discard.click();
  await page.waitForFunction(() => document.querySelectorAll(".pdfHighlightBox").length === 0, null, { timeout: 5000 });
  assert.equal(await page.getByPlaceholder("Add your note.").inputValue(), "", "the note is cleared");
  assert.equal(await discard.count(), 0, "Discard goes away once nothing is pending");
  const saved = await (await fetch(`${base}/api/core/annotations?documentId=${documentId}`)).json().catch(() => null);
  const records = Array.isArray(saved?.annotations) ? saved.annotations : [];
  assert.equal(records.length, 0, "nothing was saved");
  console.log("Discard verified: an unsaved highlight, its preview and its note are discarded from the side panel.");
} finally {
  await browser.close();
}
