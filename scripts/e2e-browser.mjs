// End-to-end browser check: open a saved PDF, select text with the mouse, save an annotation,
// reload, and confirm it is still there. Needs a running server (auth disabled) and Chromium.
// Usage: SCRIPTORIUM_BASE_URL=http://127.0.0.1:3100 node scripts/e2e-browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const title = `E2E Book ${Date.now()}`;

const form = new FormData();
form.set("file", new File([await textPdf([["Faith seeking understanding."], ["Second page text."]])], "e2e.pdf", { type: "application/pdf" }));
form.set("title", title);
const upload = await fetch(`${base}/api/core/files`, { method: "POST", body: form });
assert.ok(upload.ok, "fixture upload");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(base + "/");
  await page.click("text=Open saved");
  await page.locator(".savedDocRow", { hasText: title }).locator("button:has-text('Open')").click();
  await page.waitForLoadState("load");

  const word = page.locator(".pdfTextRun", { hasText: "Faith" }).first();
  await word.waitFor({ timeout: 20000 });
  const box = await word.boundingBox();
  assert.ok(box, "text layer is positioned");
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("Faith"), null, { timeout: 5000 });
  await page.locator("textarea").nth(1).fill("End-to-end note");
  await page.click("button.saveRecordButton");
  await page.waitForFunction(() => document.querySelector(".ledgerStatus")?.textContent?.toLowerCase().includes("saved"), null, { timeout: 10000 });

  await page.reload();
  await page.locator(".pdfTextRun", { hasText: "Faith" }).first().waitFor({ timeout: 20000 });
  await page.locator(".ledgerRecords", { hasText: "End-to-end note" }).waitFor({ timeout: 10000 });

  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log("Browser end-to-end verified: open, select text, save annotation, reload, annotation persisted.");
} finally {
  await browser.close();
}
