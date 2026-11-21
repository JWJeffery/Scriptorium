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

// The Highlights panel starts closed; open it when a check needs to look inside.
const openHighlights = async (page) => {
  const button = page.getByRole("button", { name: /^Highlights/ });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
};

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

  // Scrolling past the bottom of a page opens the next one; scrolling up past the top goes back.
  const pageNumberShown = () => page.evaluate(() => document.querySelector(".pdfPageControls strong")?.textContent);
  await page.locator(".pdfFrameViewport").hover();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, 200);
  assert.ok(await until(page, () => document.querySelector(".pdfPageControls strong")?.textContent === "2"), `scrolling down turns to the next page (shows ${await pageNumberShown()})`);
  await page.waitForTimeout(700);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, -200);
  assert.ok(await until(page, () => document.querySelector(".pdfPageControls strong")?.textContent === "1"), `scrolling up returns to the previous page (shows ${await pageNumberShown()})`);
  await page.locator(".pdfTextRun", { hasText: "Faith" }).first().waitFor({ timeout: 10000 });

  // Enter read mode with the full-screen button on the page toolbar.
  await page.getByRole("button", { name: "Full-screen read mode" }).click();
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
  const meanings = await page.locator(".readPaletteSwatch").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  assert.deepEqual(meanings, ["Thesis", "Secondary argument", "Supporting evidence", "Interesting point", "Other (purple)", "Other (teal)"], "the highlight meanings are the useful ones");
  await page.getByRole("button", { name: "Supporting evidence" }).click();
  assert.ok(await page.locator(".readPaletteSwatch.active").getAttribute("aria-label") === "Supporting evidence", "chosen meaning is marked");

  // With the highlighter on, a selection is saved by itself, with no form and no Save button.
  const word = page.locator(".pdfTextRun", { hasText: "Faith" }).first();
  const box = await word.boundingBox();
  assert.ok(box, "text layer is positioned");
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.ok(await until(page, () => document.querySelector(".readToast")?.textContent?.toLowerCase().includes("saved")), "a saved confirmation appears");

  // The highlight just saved can take a comment, from the same screen.
  await page.locator(".readNoteCard").waitFor({ timeout: 5000 });
  await page.locator(".readNoteInput").fill("A comment from read mode");
  await page.getByRole("button", { name: "Save comment" }).click();
  await page.locator(".readNoteCard").waitFor({ state: "detached", timeout: 5000 });

  // One of the "Other" colours can be named for this book; the name sticks after a reload.
  await page.getByRole("button", { name: "Other (purple)" }).click();
  await page.locator(".readPalette").getByLabel("Name for this highlight colour").fill("Heresy");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  assert.ok(await page.getByRole("button", { name: "Heresy", exact: true }).count() === 1, "the custom colour shows its new name");

  // Turn the highlighter off with its key; the palette goes away.
  await page.keyboard.press("h");
  await page.locator(".readPalette").waitFor({ state: "detached", timeout: 5000 });

  // With the highlighter off, a selection waits for Save and has room for a comment: nothing is lost on leaving.
  const again = page.locator(".pdfTextRun", { hasText: "Faith" }).first();
  const againBox = await again.boundingBox();
  assert.ok(againBox, "text layer is still positioned");
  await page.mouse.move(againBox.x + 1, againBox.y + againBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(againBox.x + againBox.width - 1, againBox.y + againBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.locator(".readNoteCard").waitFor({ timeout: 5000 });
  assert.ok((await page.locator(".readNoteCard").innerText()).includes("Save this highlight"), "an unsaved selection offers Save");
  await page.locator(".readNoteInput").fill("A pending comment");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".readNoteCard").waitFor({ state: "detached", timeout: 5000 });

  // Zoomed in past the window width, the page starts at the left edge (it is not pushed off to the
  // right) and can be scrolled across to its right edge.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(300);
  for (let step = 0; step < 8; step += 1) await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(300);
  const geometry = () => page.evaluate(() => {
    const viewportBox = document.querySelector(".pdfFrameViewport");
    const v = viewportBox.getBoundingClientRect();
    const f = document.querySelector(".pdfPageFrame").getBoundingClientRect();
    return { left: Math.round(f.left - v.left), rightGap: Math.round(v.right - f.right), pageWider: f.width > v.width + 20, scrollable: viewportBox.scrollWidth > viewportBox.clientWidth + 20 };
  });
  const atStart = await geometry();
  assert.ok(atStart.pageWider, "the zoomed page is wider than the window");
  assert.ok(atStart.left >= -2 && atStart.left < 12, `zoomed page starts at the left edge, not pushed right (left offset ${atStart.left})`);
  assert.ok(atStart.scrollable, "the zoomed page can be scrolled sideways");
  await page.evaluate(() => { document.querySelector(".pdfFrameViewport").scrollLeft = 99999; });
  await page.waitForTimeout(200);
  const atEnd = await geometry();
  assert.ok(atEnd.rightGap >= -2 && atEnd.rightGap < 12, `scrolled across, the page's right edge is reachable (gap ${atEnd.rightGap})`);
  await page.getByRole("button", { name: "Zoom out" }).click({ clickCount: 1 });
  await page.evaluate(() => { document.querySelector(".pdfFrameViewport").scrollLeft = 0; });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(300);

  // Leave read mode with the exit button: normal layout returns and the highlight is in the records.
  await page.getByRole("button", { name: "Exit read mode" }).click();
  await page.locator(".ledgerTopbar").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.locator(".readRail").count(), 0, "tool rail is gone after exit");
  await openHighlights(page);
  await page.locator(".ledgerRecords", { hasText: "Faith" }).waitFor({ timeout: 10000 });
  assert.ok(await page.locator(".ledgerRecords .recordColor").first().evaluate((node) => getComputedStyle(node).backgroundColor !== ""), "highlight colour shows");

  // The z key toggles read mode both ways.
  await page.keyboard.press("z");
  await page.locator(".readRail").waitFor({ timeout: 5000 });
  await page.keyboard.press("z");
  await page.locator(".readRail").waitFor({ state: "detached", timeout: 5000 });

  // The highlight is a real, reloadable record, and the ledger says only what matters.
  await page.reload();
  await openHighlights(page);
  await page.locator(".ledgerRecords", { hasText: "Faith" }).waitFor({ timeout: 15000 });
  assert.ok(await page.locator(".ledgerRecords", { hasText: "A comment from read mode" }).count() === 1, "the comment added to a saved highlight was kept");
  assert.ok(await page.locator(".ledgerRecords", { hasText: "A pending comment" }).count() === 1, "the comment saved with a selection was kept");
  assert.ok(await page.locator(".ledgerRecords", { hasText: "Supporting evidence" }).count() >= 1, "the record shows its meaning");
  const ledgerText = await page.locator(".ledgerPane").innerText();
  for (const noise of ["Current snapshot", "saved in the database", "database-linked", "checksum", "current snapshot"]) {
    assert.ok(!ledgerText.includes(noise), `the ledger does not show "${noise}"`);
  }
  await page.getByRole("button", { name: "Full-screen read mode" }).click();
  await page.getByRole("button", { name: "Highlighter", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Heresy", exact: true }).count() === 1, "the custom name was kept for this book");
  await page.getByRole("button", { name: "Exit read mode" }).click();

  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log("Read mode verified: full-window page, left tool rail, floating palette, highlight saved on select, exit and key toggles.");
} finally {
  await browser.close();
}
