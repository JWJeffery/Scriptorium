// End-to-end check that the reading position follows you between devices: a "laptop" and a "phone" (two separate
// browsers) have the same book open. Turning pages on one, then bringing the other back into view, takes the
// other to the same page with a note saying so; a device that just opens the book starts there; and a device
// whose own position is the newest is not pulled anywhere.
// Needs a running server (auth disabled) and Chromium.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, devices } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const form = new FormData();
form.set("file", new File([await textPdf([["Page one."], ["Page two."], ["Page three."], ["Page four."], ["Page five."]])], "position.pdf", { type: "application/pdf" }));
form.set("title", `Position sync ${Date.now()}`);
const uploaded = await (await fetch(`${base}/api/core/files?allowDuplicate=true`, { method: "POST", body: form })).json();
const id = uploaded.document.id;

const onPage = (page, n) => page.waitForFunction((n) => new RegExp(`PDF\\s*${n}\\s*/\\s*5`).test(document.body.innerText), n, { timeout: 15000 });
const open = async (context) => {
  const page = await context.newPage();
  await page.goto(`${base}/?open=${id}`);
  await page.waitForLoadState("load");
  await page.locator("canvas.pdfCanvas").waitFor({ timeout: 20000 });
  await onPage(page, 1).catch(() => undefined);
  return page;
};
// What a device does when you pick it up again: its tab becomes visible / the window gets focus.
const pickUp = async (page) => { await sleep(3200); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); };
const turnTo = async (page, n) => {
  const now = Number((await page.evaluate(() => document.body.innerText.match(/PDF\s*(\d+)\s*\//)?.[1])) ?? 1);
  const button = page.getByRole("button", { name: n > now ? "Next PDF page" : "Previous PDF page" });
  for (let i = 0; i < Math.abs(n - now); i++) await button.click();
  await onPage(page, n);
  await sleep(2500); // the position is saved 1.5 s after the last page turn
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const laptop = await open(await browser.newContext({ viewport: { width: 1400, height: 900 } }));
  const phone = await open(await browser.newContext({ ...devices["Pixel 7"] }));
  await onPage(laptop, 1);
  await onPage(phone, 1);

  // Read on the laptop to page 4, then pick up the phone.
  await turnTo(laptop, 4);
  await pickUp(phone);
  await onPage(phone, 4);
  await phone.waitForFunction(() => document.body.innerText.includes("where you left off on another device"), null, { timeout: 5000 });

  // Read on the phone to page 2, then go back to the laptop.
  await turnTo(phone, 2);
  await pickUp(laptop);
  await onPage(laptop, 2);

  // The laptop's own position is now the newest: picking it up again changes nothing.
  await turnTo(laptop, 3);
  await pickUp(laptop);
  await sleep(1000);
  await onPage(laptop, 3);

  // A third device that only now opens the book starts where the reading stopped.
  const tablet = await open(await browser.newContext({ viewport: { width: 1000, height: 1200 } }));
  await onPage(tablet, 3);
  console.log("Reading position verified: it follows you laptop -> phone -> laptop, a new device starts there, and an up-to-date device stays put.");
} finally {
  await browser.close();
}
