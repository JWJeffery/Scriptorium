// End-to-end check of reading on a phone (Pixel 7 emulation, real touch events):
//   1. a large book opens page by page: the first page shows after downloading a small part of the file;
//   2. the file route answers byte ranges, and "not modified" when the browser already has it;
//   3. a sideways swipe turns the page (left = next, right = previous); a vertical drag does not;
//   4. in full screen the page uses the whole width (the tools sit in a row at the top), and Fit width works;
//   5. afterwards the browser keeps its own copy, so reopening downloads nothing.
// Needs a running server (auth disabled) and Chromium.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, devices } = require("playwright");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";

// A 12-page book of about 12 MB: each page carries its own 1 MB image, the way a scan does.
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const { createCanvas } = require("@napi-rs/canvas");
for (let i = 1; i <= 12; i++) {
  const canvas = createCanvas(900, 1200); const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8e0cc"; ctx.fillRect(0, 0, 900, 1200);
  const noise = ctx.createImageData(900, 400); for (let p = 0; p < noise.data.length; p++) noise.data[p] = (p % 4 === 3) ? 40 : Math.random() * 255; ctx.putImageData(noise, 0, 800);
  const image = await pdf.embedPng(canvas.toBuffer("image/png"));
  const page = pdf.addPage([450, 600]);
  page.drawImage(image, { x: 0, y: 0, width: 450, height: 600 });
  page.drawText(`Phone page ${i}`, { x: 40, y: 540, size: 22, font });
}
const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
const form = new FormData();
form.set("file", new File([bytes], "phone.pdf", { type: "application/pdf" }));
form.set("title", `Phone reader ${Date.now()}`);
const uploaded = await (await fetch(`${base}/api/core/files?allowDuplicate=true`, { method: "POST", body: form })).json();
const id = uploaded.document.id;
const fileUrl = `${base}/api/core/files/${id}`;

// 2. Byte ranges and "not modified".
const head = await fetch(fileUrl, { headers: { range: "bytes=0-1023" } });
assert.equal(head.status, 206, "a byte range is answered with 206");
assert.equal(head.headers.get("content-range"), `bytes 0-1023/${bytes.length}`);
assert.deepEqual(Buffer.from(await head.arrayBuffer()), bytes.subarray(0, 1024), "the range has the right bytes");
const tail = await fetch(fileUrl, { headers: { range: "bytes=-100" } });
assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(bytes.length - 100), "a suffix range works");
assert.equal((await fetch(fileUrl, { headers: { range: `bytes=${bytes.length + 5}-` } })).status, 416, "an impossible range is refused");
const full = await fetch(fileUrl);
assert.equal(full.headers.get("accept-ranges"), "bytes");
assert.equal(createHash("sha256").update(Buffer.from(await full.arrayBuffer())).digest("hex"), createHash("sha256").update(bytes).digest("hex"), "the whole file is identical");
assert.equal((await fetch(fileUrl, { headers: { "if-none-match": full.headers.get("etag") } })).status, 304, "an unchanged file is not sent again");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  let fileBytes = 0;
  page.on("response", async (response) => {
    if (response.url().startsWith(fileUrl) && response.request().resourceType() !== "fetch") return;
    if (response.url().startsWith(fileUrl)) { const length = Number(response.headers()["content-length"] ?? 0); fileBytes += length; }
  });
  await page.route(`${fileUrl}*`, (route) => route.continue());
  const counted = [];
  page.on("requestfinished", async (request) => {
    if (!request.url().startsWith(fileUrl)) return;
    const sizes = await request.sizes().catch(() => null);
    counted.push(sizes?.responseBodySize ?? 0);
  });
  await page.goto(`${base}/?open=${id}`);
  await page.waitForLoadState("load");
  await page.waitForFunction(() => /PDF\s*1\s*\/\s*12/.test(document.body.innerText), null, { timeout: 30000 });
  await page.locator("canvas.pdfCanvas").waitFor();
  await page.waitForTimeout(1500);
  const downloadedForFirstPage = counted.reduce((a, b) => a + b, 0);
  assert.ok(downloadedForFirstPage < bytes.length * 0.5, `the first page needed only part of the file (${downloadedForFirstPage} of ${bytes.length} bytes)`);

  // 3. Swipes, as real touch input.
  const cdp = await context.newCDPSession(page);
  const box = await page.locator(".pdfPageFrame").boundingBox();
  const swipe = async (fromX, toX, fromY = box.y + 200, toY = fromY) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fromX, y: fromY }] });
    for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: fromX + ((toX - fromX) * i) / 5, y: fromY + ((toY - fromY) * i) / 5 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(700);
  };
  const shownPage = () => page.evaluate(() => (document.body.innerText.match(/PDF\s*(\d+)\s*\//) || [])[1]);
  const onPage = async (n) => {
    try {
      await page.waitForFunction((n) => new RegExp(`PDF\\s*${n}\\s*/\\s*12`).test(document.body.innerText), n, { timeout: 10000 });
    } catch {
      await page.screenshot({ path: "/tmp/claude-0/sp/phone-fail.png" }).catch(() => undefined);
      throw new Error(`expected PDF page ${n}, but the reader shows page ${await shownPage()} (address ${page.url()})`);
    }
  };
  await swipe(320, 80); await onPage(2);
  await swipe(320, 80); await onPage(3);
  await swipe(80, 320); await onPage(2);
  await swipe(200, 210, box.y + 100, box.y + 400); // a vertical drag
  await onPage(2);

  // 4. Full screen on a phone.
  await page.keyboard.press("r").catch(() => undefined);
  if (!(await page.locator(".ledgerWorkspace.readMode").count())) await page.locator("button[title*='ull']").first().click();
  await page.locator(".ledgerWorkspace.readMode").waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  const layout = await page.evaluate(() => {
    const frame = document.querySelector(".pdfPageFrame").getBoundingClientRect();
    const rail = document.querySelector(".readRail").getBoundingClientRect();
    return { left: frame.left, right: frame.right, top: frame.top, width: window.innerWidth, railBottom: rail.bottom, railLeft: rail.left, railRight: rail.right };
  });
  assert.ok(layout.left >= 0 && layout.right <= layout.width + 1, `the page fits the screen (${JSON.stringify(layout)})`);
  assert.ok(layout.right - layout.left > layout.width * 0.9, `the page uses the screen's width (${JSON.stringify(layout)})`);
  assert.ok(layout.top >= layout.railBottom - 1, `the tools do not cover the page (${JSON.stringify(layout)})`);
  await page.getByRole("button", { name: "Fit width" }).click();
  await page.waitForTimeout(400);
  const afterFit = await page.evaluate(() => { const f = document.querySelector(".pdfPageFrame").getBoundingClientRect(); return { left: f.left, right: f.right, width: window.innerWidth }; });
  assert.ok(afterFit.left >= -1 && afterFit.right <= afterFit.width + 1 && afterFit.right - afterFit.left > afterFit.width * 0.9, `Fit width fills the screen (${JSON.stringify(afterFit)})`);
  await swipe(320, 80); await onPage(3); // swiping works in full screen too

  // 5. The browser keeps its own copy: reopening downloads nothing from the file route.
  await page.waitForTimeout(10000); // the copy is made a few seconds after opening
  counted.length = 0;
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.reload();
  await page.waitForLoadState("load");
  await page.locator("canvas.pdfCanvas").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  assert.equal(counted.reduce((a, b) => a + b, 0), 0, "reopening the book used this browser's copy");
  console.log(`Phone reading verified: first page after ${Math.round((downloadedForFirstPage / bytes.length) * 100)}% of the file, byte ranges and 304, swipes turn pages (not vertical drags), full screen fits the width, reopening downloads nothing.`);
} finally {
  await browser.close();
}
