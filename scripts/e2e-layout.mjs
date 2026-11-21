// End-to-end browser check of the reading-first layout: the page opens with no side panels, the top bar is
// short, Highlights and Details open on demand, a selection opens Details by itself, and the screen carries
// no technical chatter. Needs a running server (auth disabled) and Chromium.
// Usage: SCRIPTORIUM_BASE_URL=http://127.0.0.1:3100 node scripts/e2e-layout.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const title = `Layout Check ${Date.now()}`;

const form = new FormData();
form.set("file", new File([await textPdf([["Faith seeking understanding."], ["Second page."]])], "layout.pdf", { type: "application/pdf" }));
form.set("title", title);
assert.ok((await fetch(`${base}/api/core/files?allowDuplicate=true`, { method: "POST", body: form })).ok, "fixture upload");

const visible = (page, selector) => page.locator(selector).first().isVisible().catch(() => false);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(base + `/library?q=${encodeURIComponent(title)}`);
  await page.locator("tbody tr").first().getByRole("link", { name: "Read", exact: true }).click();
  await page.locator(".pdfTextRun", { hasText: "Faith" }).first().waitFor({ timeout: 20000 });

  // Opens with the page alone.
  assert.equal(await visible(page, ".ledgerPane"), false, "Highlights is closed when a book opens");
  assert.equal(await visible(page, ".inspectorPane"), false, "Details is closed when a book opens");
  const bar = await page.locator(".ledgerActions").evaluate((node) => [...node.querySelectorAll("a, button")].filter((x) => x.getBoundingClientRect().width > 0).map((x) => (x.getAttribute("aria-label") || x.textContent || "").replace(/\d+$/, "").trim()));
  assert.deepEqual(bar, ["Search", "Highlights", "Details", "Library", "Appearance", "More"], "the top bar is short and plain");
  const reader = await page.locator(".ledgerReader").boundingBox();
  assert.ok(reader.width > 1300, `the page area uses the width (${Math.round(reader.width)}px)`);
  const statusBox = await page.locator(".ledgerStatus").boundingBox();
  assert.ok(!statusBox || statusBox.height <= 2, "there is no status bar (it is kept only for screen readers)");

  // Highlights opens and closes on demand.
  const highlights = page.getByRole("button", { name: /^Highlights/ });
  await highlights.click();
  await page.locator(".ledgerPane").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await highlights.getAttribute("aria-pressed"), "true", "the button shows the panel is open");
  await highlights.click();
  await page.locator(".ledgerPane").waitFor({ state: "hidden", timeout: 5000 });

  // Selecting text opens Details by itself; the panel says nothing technical.
  const word = page.locator(".pdfTextRun", { hasText: "Faith" }).first();
  const box = await word.boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.locator(".inspectorPane").waitFor({ state: "visible", timeout: 5000 });
  const details = await page.locator(".inspectorPane").innerText();
  assert.ok(!/anchor captured|rectangle|metadata|mapping/i.test(details), "Details carries no technical wording");
  assert.ok(/Book information/.test(details) && /Page numbers/.test(details), "the book-information and page-number sections are named plainly");
  const openSections = await page.locator(".inspectorGroup[open]").count();
  assert.equal(openSections, 0, "book information and page numbers start collapsed");

  // Saving says one short thing.
  await page.locator(".saveRecordButton").click();
  await page.locator(".readToast").waitFor({ timeout: 5000 });
  assert.equal((await page.locator(".readToast").innerText()).trim(), "Highlight saved.", "saving confirms in plain words");

  // Details closes from the top bar.
  await page.getByRole("button", { name: "Details" }).click();
  await page.locator(".inspectorPane").waitFor({ state: "hidden", timeout: 5000 });

  // The More menu holds the occasional things.
  await page.getByRole("button", { name: "More" }).click();
  const items = await page.getByRole("menuitem").allInnerTexts();
  assert.deepEqual(items, ["Add a book…", "Bookmark this page", "Tools", "Keyboard shortcuts"], "the More menu offers the occasional things");
  await page.keyboard.press("Escape");

  // Which panels were left open is remembered.
  await highlights.click();
  await page.locator(".ledgerPane").waitFor({ state: "visible" });
  await page.reload();
  await page.locator(".pdfTextRun", { hasText: "Faith" }).first().waitFor({ timeout: 20000 });
  await page.locator(".ledgerPane").waitFor({ state: "visible", timeout: 5000 });

  // On a narrow window panels are drawers over the page, not columns squeezing it.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(400);
  const narrow = await page.locator(".ledgerReader").boundingBox();
  assert.ok(narrow.width > 800, `on a narrow window the page keeps the full width (${Math.round(narrow.width)}px)`);

  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log("Layout verified: panels closed by default and on demand, short top bar, plain wording, no status bar.");
  await context.close();
} finally {
  await browser.close();
}
