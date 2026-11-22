// End-to-end check that saving is safe when the server misbehaves:
//   1. a highlight saved twice with the same browser id is stored once (a retried save never duplicates);
//   2. an edit the server refuses is kept, survives a sync from the database, and "Save to the database" sends it;
//   3. the message says what the server actually said, not "could not be reached".
// Needs a running server (auth disabled), PostgreSQL in DATABASE_URL (psql) and Chromium.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const sql = (query) => execSync(`psql "${process.env.DATABASE_URL}" -At -c ${JSON.stringify(query)}`).toString().trim();

const form = new FormData();
form.set("file", new File([await textPdf([["Faith seeking understanding."]])], "safety.pdf", { type: "application/pdf" }));
form.set("title", `Save safety ${Date.now()}`);
const uploaded = await (await fetch(`${base}/api/core/files?allowDuplicate=true`, { method: "POST", body: form })).json();
const ids = { documentId: uploaded.document.id, versionId: uploaded.version.id, sourceId: uploaded.source.id, pageMapId: uploaded.pageMap.id };

// 1. The same save twice (a reply was lost and the browser retried).
const save = () => fetch(`${base}/api/core/annotations`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...ids, clientId: `ann_retry_${ids.documentId}`, colorKey: "yellow", selectedText: "Faith", note: "", tags: [], anchor: { selectedText: "Faith", pageNumber: 1, rects: [] }, citationStyle: "sbl-note", citationText: "x, 1.", locatorValue: "1" })
});
const [first, second] = await Promise.all([save(), save()]);
assert.ok(first.ok && second.ok, `both answers succeed (${first.status}, ${second.status})`);
const third = await save();
assert.equal(third.status, 200, "a later retry is answered with the existing highlight");
assert.equal((await third.json()).alreadySaved, true);
assert.equal(sql(`select count(*) from "Annotation" where "documentId"='${ids.documentId}'`), "1", "only one highlight is stored");

// 2 + 3. An edit the server refuses.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(`${base}/?open=${ids.documentId}`);
  await page.waitForLoadState("load");
  await page.locator(".pdfTextRun", { hasText: "Faith" }).first().waitFor({ timeout: 20000 });
  const openList = async () => {
    const highlights = page.getByRole("button", { name: /^Highlights/ });
    if ((await highlights.getAttribute("aria-pressed")) !== "true") await highlights.click();
  };
  await openList();
  await page.locator(".ledgerRecords .recordOpen").first().click();
  await page.getByRole("button", { name: "Save changes" }).waitFor({ timeout: 10000 });

  await page.route("**/api/core/annotations", (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The database is restarting" }) })
    : route.continue());
  await page.getByPlaceholder("Add your note.").fill("A note written while the server said no");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("the server refused it: The database is restarting"), null, { timeout: 10000 });
  assert.equal(sql(`select coalesce(note,'') from "Annotation" where "documentId"='${ids.documentId}'`), "", "the database did not get the edit yet");

  // A sync from the database (it used to silently put the old note back).
  await page.reload();
  await page.waitForLoadState("load");
  await openList();
  await page.getByRole("button", { name: "Check again" }).click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForFunction(() => document.body.innerText.includes("A note written while the server said no"), null, { timeout: 10000 });
  await page.waitForFunction(() => document.body.innerText.includes("not yet saved to the database"), null, { timeout: 10000 });

  await page.unroute("**/api/core/annotations");
  const resent = page.waitForResponse((response) => response.url().includes("/api/core/annotations") && response.request().method() === "PATCH", { timeout: 15000 });
  await page.getByRole("button", { name: "Save to the database" }).click();
  assert.equal((await resent).status(), 200, "the unsent edit is sent again and accepted");
  // What matters is the database (a status line can be replaced a moment later by a newer message).
  let stored = "";
  for (let i = 0; i < 30 && stored !== "A note written while the server said no"; i += 1) {
    stored = sql(`select coalesce(note,'') from "Annotation" where "documentId"='${ids.documentId}'`);
    if (stored !== "A note written while the server said no") await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(stored, "A note written while the server said no", `the edit reached the database (screen said: ${(await page.locator("body").innerText()).match(/Saved[^\n]*|not yet saved[^\n]*|refused[^\n]*/)?.[0] ?? "nothing relevant"})`);
  await page.waitForFunction(() => !document.body.innerText.includes("not yet saved to the database"), null, { timeout: 10000 });
  console.log("Save safety verified: retried saves never duplicate, refused edits survive a sync and are re-sent, real reasons are shown.");
} finally {
  await browser.close();
}
