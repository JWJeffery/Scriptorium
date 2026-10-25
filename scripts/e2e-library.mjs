// Real-browser check of the Library screens: filters live in the address (so Back works), selecting and
// batch changes, collections, the delete preview and restore, duplicates, opening a book in the reader,
// and the reader saving reading progress to the server. Needs a running server (auth disabled) and Chromium.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const stamp = Date.now();
const api = async (path, init) => {
  const response = await fetch(`${base}${path}`, init);
  return { status: response.status, body: await response.json().catch(() => null) };
};
// Polls until the check is true (an async check cannot be passed to page.waitForFunction).
async function until(check, message, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const send = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function upload(name, pages, author) {
  const form = new FormData();
  form.set("file", new File([await textPdf(pages)], `${name}.pdf`, { type: "application/pdf" }));
  form.set("title", `${name} ${stamp}`);
  if (author) form.set("author", author);
  const result = await api("/api/core/files?allowDuplicate=true", { method: "POST", body: form });
  assert.equal(result.status, 201);
  return result.body.document.id;
}

const alpha = await upload("Alpha Book", [["Alpha page one"], ["Alpha page two"], ["Alpha page three"]], "Alice Writer");
const beta = await upload("Beta Book", [["Beta one"], ["Beta two"]], "Bob Writer");
const gamma = await upload("Gamma Book", [["Gamma one"]]);
await api(`/api/v1/items/${alpha}`, send("PATCH", { state: "reading", tags: ["liturgy"], favorite: true }));
await api(`/api/v1/items/${gamma}`, send("PATCH", { state: "archived" }));
await upload("Alpha Book copy", [["Alpha page one"], ["Alpha page two"], ["Alpha page three"]], "Alice Writer");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rows = (count, message) => page.waitForFunction((n) => document.querySelectorAll("tbody tr").length === n, count, { timeout: 8000 }).catch(async () => { assert.fail(`${message} (saw ${await page.locator("tbody tr").count()} rows, wanted ${count})`); });
  const row = (title) => page.locator("tbody tr", { hasText: `${title} ${stamp}` });

  // Filters live in the address, and Back returns to them.
  await page.goto(`${base}/library?q=${stamp}`);
  await row("Alpha Book").first().waitFor();
  await rows(4, "all four books match the stamp");
  await page.getByRole("button", { name: "Reading", exact: true }).click();
  await page.waitForURL(/view=reading/);
  await rows(1, "the Reading view shows the one book in that state");
  await page.goBack();
  await page.waitForURL((url) => !url.search.includes("view=reading"));
  await row("Beta Book").waitFor();
  await rows(4, "Back returns to the earlier list");
  await page.getByRole("searchbox", { name: "Search the library" }).fill(`Gamma Book ${stamp}`);
  await page.waitForURL(/q=Gamma/);
  await rows(1, "typing in the search box filters by title");
  await page.getByRole("searchbox", { name: "Search the library" }).fill(String(stamp));
  await page.waitForURL(new RegExp(`q=${stamp}`));
  await row("Beta Book").waitFor();

  // Change a state in the row; it is saved on the server.
  await row("Beta Book").getByRole("combobox", { name: /State of/ }).selectOption("reading");
  await until(async () => (await api(`/api/v1/items/${beta}`)).body.state === "reading", "the state change reached the server");

  // Select two, add them to a new collection.
  await row("Alpha Book").first().getByRole("checkbox").check();
  await row("Beta Book").getByRole("checkbox").check();
  await page.getByText("2 selected").waitFor();
  await page.getByRole("button", { name: "Add to collection…" }).click();
  await page.getByPlaceholder("Collection name").fill(`Thesis ${stamp}`);
  await page.getByRole("dialog").getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`Thesis ${stamp}`) }).first().waitFor();
  await page.getByRole("button", { name: new RegExp(`Thesis ${stamp}`) }).first().click();
  await page.waitForURL(/collection=/);
  await rows(2, "the collection holds the two chosen books");

  // Delete shows exactly what is affected, Escape cancels, confirming removes, Deleted lists it, Restore returns it.
  await row("Alpha Book").first().getByRole("checkbox").check();
  await page.getByRole("button", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(/in 1 collection/).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await rows(2, "cancelling deletes nothing");
  await page.getByRole("button", { name: "Delete…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Delete 1 book/ }).click();
  await page.getByText(/deleted\. Find it under Deleted/).waitFor();
  await rows(1, "the deleted book leaves the collection view");
  await page.goto(`${base}/library?view=deleted`);
  await page.getByRole("link", { name: `Alpha Book ${stamp}` }).first().waitFor();
  await page.getByRole("row", { name: new RegExp(`Alpha Book ${stamp}`) }).first().getByRole("button", { name: "Restore" }).click();
  await page.getByText(/was restored/).waitFor();

  // Identical files are reported.
  await page.goto(`${base}/library`);
  await page.getByRole("button", { name: /sets? of identical files/ }).click();
  await page.getByRole("dialog").getByRole("link", { name: new RegExp(`Alpha Book ${stamp}`) }).first().waitFor();
  await page.keyboard.press("Escape");

  // The detail page.
  await page.goto(`${base}/items/${alpha}`);
  await page.getByRole("heading", { name: `Alpha Book ${stamp}` }).waitFor();
  await page.getByRole("tab", { name: "Metadata" }).click();
  await page.getByText("Alice Writer").waitFor();
  await page.getByRole("tab", { name: "Versions" }).click();
  await page.locator("code").first().waitFor();
  await page.getByRole("tab", { name: "Relations" }).click();
  await page.getByText(/No related items yet/).waitFor();

  // Open in the reader, turn a page, and the server remembers where we got to.
  await page.getByRole("link", { name: "Open in the reader" }).click();
  await page.waitForURL(`${base}/`);
  await page.getByText(`Alpha Book ${stamp}`).first().waitFor({ timeout: 20000 });
  await page.locator(".pdfTextRun", { hasText: "Alpha" }).first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Next PDF page" }).click();
  await until(async () => (await api(`/api/v1/items/${alpha}`)).body.progress.lastPage === 2, "the server remembers the page the reader reached");
  await page.getByRole("link", { name: "Library" }).click();
  await page.waitForURL(`${base}/library`);
  await page.goto(`${base}/library?q=Alpha Book ${stamp}`);
  await row("Alpha Book").first().getByText(/%/).waitFor();

  // Jobs and Inbox pages load.
  await page.goto(`${base}/jobs`);
  await page.getByRole("heading", { name: "Background jobs" }).waitFor();
  await page.goto(`${base}/inbox`);
  await page.getByText(/Nothing to review/).waitFor();

  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log("Library browser check verified: filters in the address, batch changes, collections, delete preview and restore, duplicates, item detail, reader hand-off and saved progress.");
} finally {
  await browser.close();
}
