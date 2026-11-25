// End-to-end check of Add a book from a link, from Box and from Google Drive, in a real browser.
// Box and Google cannot be signed in to from a test, so this stands in for them: a local server speaks Box's OAuth
// and file API, and two small scripts stand in for Google's sign-in and Picker. Everything of Scriptorium's own is
// real: the dialog, the server routes, the token storage, and the normal "add a book" path the file ends up in.
// The server under test needs (besides auth disabled):
//   SCRIPTORIUM_IMPORT_ALLOW_PRIVATE=true SCRIPTORIUM_BOX_CLIENT_ID=test-box SCRIPTORIUM_BOX_CLIENT_SECRET=test-secret
//   SCRIPTORIUM_BOX_AUTH_BASE=http://127.0.0.1:4601 SCRIPTORIUM_BOX_API_BASE=http://127.0.0.1:4601
//   SCRIPTORIUM_GOOGLE_CLIENT_ID=test.apps.googleusercontent.com SCRIPTORIUM_GOOGLE_API_KEY=test-key SCRIPTORIUM_GOOGLE_APP_ID=1234
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { textPdf } from "./lib-test-pdf.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const stamp = Date.now();
const pdfFor = async (title) => Buffer.from(await textPdf([[title], ["Second page."]]));
const linkPdf = await pdfFor(`Linked book ${stamp}`);
const boxPdf = await pdfFor(`Box book ${stamp}`);
const drivePdf = await pdfFor(`Drive book ${stamp}`);
const boxCalls = [];

// Stand-in for a web server and for Box.
const mock = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:4601");
  const json = (status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
  const authed = request.headers.authorization === "Bearer box-access";
  if (url.pathname === `/link-${stamp}.pdf`) { response.writeHead(200, { "content-type": "application/pdf" }); return response.end(linkPdf); }
  if (url.pathname === "/moved") { response.writeHead(302, { location: `/link-${stamp}.pdf` }); return response.end(); }
  if (url.pathname === "/page.html") { response.writeHead(200, { "content-type": "text/html" }); return response.end("<!doctype html><title>not a pdf</title>"); }
  if (url.pathname === "/api/oauth2/authorize") {
    boxCalls.push("authorize");
    assert.equal(url.searchParams.get("client_id"), "test-box");
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "good-code");
    back.searchParams.set("state", url.searchParams.get("state"));
    response.writeHead(302, { location: back.toString() });
    return response.end();
  }
  if (url.pathname === "/oauth2/token" && request.method === "POST") {
    let body = ""; for await (const chunk of request) body += chunk;
    const form = new URLSearchParams(body);
    boxCalls.push(`token:${form.get("grant_type")}`);
    if (form.get("client_secret") !== "test-secret" || (form.get("grant_type") === "authorization_code" && form.get("code") !== "good-code")) return json(400, { error: "invalid_grant" });
    return json(200, { access_token: "box-access", refresh_token: "box-refresh", expires_in: 3600 });
  }
  if (!authed && url.pathname.startsWith("/2.0/")) return json(401, { error: "unauthorized" });
  if (url.pathname === "/2.0/users/me") return json(200, { login: "reader@example.org" });
  if (url.pathname === "/2.0/folders/0") return json(200, { id: "0", name: "All Files", path_collection: { entries: [] } });
  if (url.pathname === "/2.0/folders/0/items") return json(200, { total_count: 2, entries: [{ id: "11", type: "folder", name: "Theology" }, { id: "21", type: "file", name: "shopping.txt", size: 10 }] });
  if (url.pathname === "/2.0/folders/11") return json(200, { id: "11", name: "Theology", path_collection: { entries: [{ id: "0", name: "All Files" }] } });
  if (url.pathname === "/2.0/folders/11/items") return json(200, { total_count: 1, entries: [{ id: "31", type: "file", name: `Box book ${stamp}.pdf`, size: boxPdf.length }] });
  if (url.pathname === "/2.0/files/31") return json(200, { name: `Box book ${stamp}.pdf`, size: boxPdf.length });
  if (url.pathname === "/2.0/files/31/content") { response.writeHead(302, { location: "/dl/31" }); return response.end(); }
  if (url.pathname === "/dl/31") { response.writeHead(200, { "content-type": "application/octet-stream" }); return response.end(boxPdf); }
  json(404, { error: "not found" });
});
await new Promise((resolve) => mock.listen(4601, "127.0.0.1", resolve));

// Stand-ins for Google's two scripts: a sign-in that hands out a token, and a Picker where the reader picks one PDF.
const googleSignIn = `window.google = window.google || {}; window.google.accounts = { oauth2: { initTokenClient: (o) => ({ requestAccessToken: () => setTimeout(() => o.callback({ access_token: "drive-token" }), 20) }) } };`;
const googleApi = `window.gapi = { load: (name, o) => {
  window.google = window.google || {};
  function Builder() { this.cb = null; }
  Builder.prototype.addView = function () { return this; }; Builder.prototype.setOAuthToken = function (t) { this.token = t; return this; };
  Builder.prototype.setDeveloperKey = function (k) { this.key = k; return this; }; Builder.prototype.setAppId = function () { return this; };
  Builder.prototype.setTitle = function () { return this; }; Builder.prototype.setCallback = function (c) { this.cb = c; return this; };
  Builder.prototype.build = function () { const b = this; return { setVisible: () => setTimeout(() => { if (b.token !== "drive-token" || b.key !== "test-key") throw new Error("picker not configured"); b.cb({ action: "picked", docs: [{ id: "drive-file-1", name: "Drive book ${stamp}.pdf" }] }); }, 20) }; };
  function View() {} View.prototype.setMimeTypes = function () { return this; }; View.prototype.setIncludeFolders = function () { return this; }; View.prototype.setSelectFolderEnabled = function () { return this; };
  window.google.picker = { PickerBuilder: Builder, DocsView: View, ViewId: { DOCS: "docs" }, Action: { PICKED: "picked", CANCEL: "cancel" }, Response: { ACTION: "action", DOCUMENTS: "docs" }, Document: { ID: "id", NAME: "name" } };
  o.callback();
} };`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: googleSignIn }));
  await page.route("https://apis.google.com/js/api.js", (route) => route.fulfill({ contentType: "text/javascript", body: googleApi }));
  await page.route("https://www.googleapis.com/drive/v3/files/**", (route) => {
    assert.equal(route.request().headers().authorization, "Bearer drive-token", "the Drive download uses the picker's token");
    return route.fulfill({ contentType: "application/pdf", body: drivePdf });
  });
  const openDialog = async () => {
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Add a book…" }).click();
    await page.getByRole("dialog", { name: "Add a book" }).waitFor({ timeout: 5000 });
  };
  const added = async (title) => page.waitForFunction((t) => document.body.innerText.includes(t), title, { timeout: 30000 });
  const inLibrary = async (title) => {
    const found = await (await fetch(`${base}/api/v1/items?q=${encodeURIComponent(title)}`)).json();
    return (found.items ?? []).some((item) => item.title === title);
  };
  await page.goto(base);
  await page.waitForLoadState("load");

  // The options shown depend on what is set up; here everything is.
  await openDialog();
  for (const option of ["From this device", "From a link", "From Google Drive", "From Box"]) await page.getByRole("button", { name: new RegExp(option) }).waitFor({ timeout: 10000 });

  // From a link: a page that is not a PDF is refused with a reason, then a redirecting link to a PDF works.
  await page.getByRole("button", { name: /From a link/ }).click();
  await page.getByLabel("Link to the PDF").fill("http://127.0.0.1:4601/page.html");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "web page, not a PDF" }).waitFor({ timeout: 10000 });
  await page.getByLabel("Link to the PDF").fill("http://127.0.0.1:4601/moved");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add a book" }).waitFor({ state: "detached", timeout: 30000 });
  await added(`link-${stamp}`);
  assert.ok(await inLibrary(`link-${stamp}`), "the linked PDF is in the library");

  // From Box: connect (sign in), browse into a folder, pick the PDF (non-PDF files are not listed).
  await openDialog();
  await page.getByRole("button", { name: /From Box/ }).click();
  await page.getByRole("link", { name: "Connect Box" }).click();
  await page.getByRole("dialog", { name: "Add a book" }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /Theology/ }).waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole("button", { name: /shopping\.txt/ }).count(), 0, "only folders and PDFs are listed");
  await page.getByRole("button", { name: /Theology/ }).click();
  await page.getByRole("button", { name: new RegExp(`Box book ${stamp}`) }).click();
  await page.getByRole("dialog", { name: "Add a book" }).waitFor({ state: "detached", timeout: 30000 });
  assert.ok(await inLibrary(`Box book ${stamp}`), "the Box PDF is in the library");
  assert.deepEqual(boxCalls.slice(0, 2), ["authorize", "token:authorization_code"], "Box's sign-in was used");
  const config = await (await fetch(`${base}/api/import/config`)).json();
  assert.deepEqual(config.box, { connected: true, account: "reader@example.org" }, "the connection is remembered");

  // From Google Drive: sign in, pick, download with the token.
  await openDialog();
  await page.getByRole("button", { name: /From Google Drive/ }).click();
  await page.getByRole("dialog", { name: "Add a book" }).waitFor({ state: "detached", timeout: 30000 });
  assert.ok(await inLibrary(`Drive book ${stamp}`), "the Google Drive PDF is in the library");

  // Disconnecting Box forgets the sign-in.
  await openDialog();
  await page.getByRole("button", { name: /From Box/ }).click();
  // The button sends its disconnect request in the background, so wait for that request to finish before asking
  // the server whether Box is still connected (asking straight away raced the request and failed intermittently).
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname === "/api/import/box"),
    page.getByRole("button", { name: "Disconnect Box" }).click()
  ]);
  assert.equal((await (await fetch(`${base}/api/import/config`)).json()).box.connected, false, "Box is disconnected");
  console.log("Add a book verified: from a link (refusing a non-PDF), from Box (sign-in, folders, PDFs only, disconnect) and from Google Drive.");
} finally {
  await browser.close();
  mock.close();
}
