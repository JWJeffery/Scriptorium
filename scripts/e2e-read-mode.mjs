// End-to-end browser check of read mode: the page fills the window, a slim tool rail appears on the
// left, the highlighter opens a floating palette, and selecting text with it on saves a highlight
// straight away in the chosen colour. Needs a running server (auth disabled) and Chromium.
// Usage: SCRIPTORIUM_BASE_URL=http://127.0.0.1:3100 node scripts/e2e-read-mode.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const title = `Focus Check ${Date.now()}`;

const form = new FormData();
form.set("file", new File([await textPdf([["Faith seeking understanding."], ["Second page text."]])], "read-mode.pdf", { type: "application/pdf" }));
form.set("title", title);
const upload = await fetch(`${base}/api/core/files?allowDuplicate=true`, { method: "POST", body: form });
assert.ok(upload.ok, "fixture upload");

// Polls a browser-side condition; resolves false instead of hanging when it never becomes true.
async function until(page, predicate, arg, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(predicate, arg)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(base + `/library?q=${encodeURIComponent(title)}`);
  await page.locator("tr", { hasText: title }).getByRole("link", { name: "Read", exact: true }).click();
  await page.waitForURL(`${base}/`);
  await page.locator(".pdfTextRun", { hasText: "Faith" }).first().waitFor({ timeout: 20000 });

  // Normal layout first: top bar and side panes are showing.
  assert.ok(await page.locator(".ledgerTopbar").isVisible(), "top bar is visible before read mode");
  assert.equal(await page.locator(".readRail").count(), 0, "no tool rail before read mode");

  // Enter read mode with the button.
  await page.getByRole("button", { name: "Read mode" }).click();
  await page.locator(".readRail").waitFor({ timeout: 5000 });
  assert.ok(await page.locator(".ledgerWorkspace.readMode").count() === 1, "read mode class applied");
  assert.equal(await page.locator(".ledgerTopbar").isVisible(), false, "top bar is hidden in read mode");
  assert.equal(await page.locator(".inspectorPane").isVisible(), false, "annotation form is hidden in read mode");
  assert.equal(await page.locator(".ledgerPane").isVisible(), false, "records pane is hidden in read mode");
  const viewport = page.viewportSize();
  const reader = await page.locator(".ledgerReader").boundingBox();
  assert.ok(reader && reader.width >= viewport.width - 2 && reader.height >= viewport.height - 2, "the page fills the window");
  const rail = await page.locator(".readRail").boundingBox();
  assert.ok(rail && rail.x < 40 && rail.width < 80, "tool rail is a slim strip on the left");

  // The highlighter opens a floating palette; the palette is closed until then.
  assert.equal(await page.locator(".readPalette").count(), 0, "palette closed until the highlighter is chosen");
  await page.getByRole("button", { name: "Highlighter", exact: true }).click();
  await page.locator(".readPalette").waitFor({ timeout: 5000 });
  assert.equal(await page.locator(".readPaletteSwatch").count(), 10, "all ten highlight meanings are offered");
  await page.getByRole("button", { name: "Primary claim" }).click();
  assert.ok(await page.locator(".readPaletteSwatch.active").getAttribute("aria-label") === "Primary claim", "chosen meaning is marked");

  // With the highlighter on, a selection is saved by itself, with no form and no Save button.
  const word = page.locator(".pdfTextRun", { hasText: "Faith" }).first();
  const box = await word.boundingBox();
  assert.ok(box, "text layer is positioned");
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.ok(await until(page, () => document.querySelector(".readToast")?.textContent?.toLowerCase().includes("saved")), "a saved confirmation appears");

  // Turn the highlighter off with its key; the palette goes away.
  await page.keyboard.press("h");
  await page.locator(".readPalette").waitFor({ state: "detached", timeout: 5000 });

  // Leave read mode with the exit button: normal layout returns and the highlight is in the records.
  await page.getByRole("button", { name: "Exit read mode" }).click();
  await page.locator(".ledgerTopbar").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.locator(".readRail").count(), 0, "tool rail is gone after exit");
  await page.locator(".ledgerRecords", { hasText: "Faith" }).waitFor({ timeout: 10000 });
  assert.ok(await page.locator(".ledgerRecords .recordColor").first().evaluate((node) => getComputedStyle(node).backgroundColor !== ""), "highlight colour shows");

  // The z key toggles read mode both ways.
  await page.keyboard.press("z");
  await page.locator(".readRail").waitFor({ timeout: 5000 });
  await page.keyboard.press("z");
  await page.locator(".readRail").waitFor({ state: "detached", timeout: 5000 });

  // The highlight is a real, reloadable record.
  await page.reload();
  await page.locator(".ledgerRecords", { hasText: "Faith" }).waitFor({ timeout: 15000 });

  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log("Read mode verified: full-window page, left tool rail, floating palette, highlight saved on select, exit and key toggles.");
} finally {
  await browser.close();
}
