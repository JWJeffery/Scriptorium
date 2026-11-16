// End-to-end browser check of light and dark themes: the choice follows the computer by default, can be set
// by hand and survives a reload, scanned PDF pages go dark with the theme unless kept light, and nothing
// stays bright white in the dark theme. Needs a running server (auth disabled) and Chromium.
// Usage: SCRIPTORIUM_BASE_URL=http://127.0.0.1:3100 node scripts/e2e-theme.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const title = `Theme Check ${Date.now()}`;

const form = new FormData();
form.set("file", new File([await textPdf([["Light and dark."], ["Second page."]])], "theme.pdf", { type: "application/pdf" }));
form.set("title", title);
assert.ok((await fetch(`${base}/api/core/files?allowDuplicate=true`, { method: "POST", body: form })).ok, "fixture upload");

const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  // 1. The theme follows the computer by default.
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(base + `/library?q=${encodeURIComponent(title)}`);
    await page.locator("tbody tr").first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), scheme, `follows the computer (${scheme})`);
    const background = luminance(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
    assert.ok(scheme === "dark" ? background < 0.2 : background > 0.8, `${scheme}: the page background is ${scheme}`);
    await context.close();
  }

  // 2. Choosing by hand wins over the computer, and is remembered.
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + `/library?q=${encodeURIComponent(title)}`);
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "chosen dark applies at once");
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "the choice survives a reload");

  // 3. In the reader, scanned pages go dark with the theme, and can be kept light.
  await page.locator("tbody tr").first().getByRole("link", { name: "Read", exact: true }).click();
  await page.locator(".pdfTextRun").first().waitFor({ timeout: 20000 });
  const canvasFilter = () => page.evaluate(() => getComputedStyle(document.querySelector(".pdfCanvas")).filter);
  assert.ok((await canvasFilter()).includes("invert"), "the PDF page is inverted in the dark theme");
  const panelBackground = luminance(await page.evaluate(() => getComputedStyle(document.querySelector(".ledgerPane")).backgroundColor === "rgba(0, 0, 0, 0)" ? getComputedStyle(document.querySelector(".ledgerWorkspace")).backgroundColor : getComputedStyle(document.querySelector(".ledgerPane")).backgroundColor));
  assert.ok(panelBackground < 0.25, "the side panels are dark");
  // No form control is left bright white.
  const bright = await page.evaluate(() => [...document.querySelectorAll("input:not([type=checkbox]), textarea, select, .tagChips")]
    .filter((node) => node.getBoundingClientRect().width > 0)
    .filter((node) => { const m = getComputedStyle(node).backgroundColor.match(/\d+(\.\d+)?/g); return m && Number(m[3] ?? 1) > 0.5 && (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 > 0.8; })
    .map((node) => node.className || node.tagName));
  assert.deepEqual(bright, [], "no input or box stays bright white in the dark theme");

  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Dark PDF pages").uncheck();
  assert.ok(!(await canvasFilter()).includes("invert"), "the page stays light when 'Dark PDF pages' is off");
  await page.getByLabel("Dark PDF pages").check();
  assert.ok((await canvasFilter()).includes("invert"), "the page goes dark again when it is turned back on");

  // 4. Read mode carries the control too.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Full-screen read mode" }).click();
  await page.locator(".readRail").waitFor();
  await page.locator(".readRail").getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light", "read mode can switch the theme");
  assert.ok(!(await canvasFilter()).includes("invert"), "the page is not inverted in the light theme");

  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log("Theme verified: follows the computer, can be chosen and remembered, PDF pages go dark or stay light, no bright-white leftovers, read mode switch.");
  await context.close();
} finally {
  await browser.close();
}
