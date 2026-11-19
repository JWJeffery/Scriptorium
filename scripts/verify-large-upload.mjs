// A book bigger than 10 MB must upload and be stored on the server. Next.js keeps only the first 10 MB of a
// request body that passes through middleware unless told otherwise; the first real book (41 MB) arrived cut
// off and silently stayed in the browser only. Needs a running server.
// Usage: SCRIPTORIUM_BASE_URL=http://127.0.0.1:3100 node scripts/verify-large-upload.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { PDFDocument, PDFName, StandardFonts } = require("pdf-lib");
const base = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";
const { SCRIPTORIUM_AUTH_USER: user, SCRIPTORIUM_AUTH_PASSWORD: password } = process.env;
const auth = user && password ? { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` } : {};

// A real, valid PDF of about 14 MB: one page of text plus a block of incompressible data.
const pdf = await PDFDocument.create({ updateMetadata: false });
const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage([420, 560]).drawText("A large book page.", { x: 40, y: 500, size: 13, font });
pdf.catalog.set(PDFName.of("Padding"), pdf.context.register(pdf.context.stream(randomBytes(14 * 1024 * 1024))));
const bytes = await pdf.save();
assert.ok(bytes.length > 12 * 1024 * 1024, "the test file is bigger than 10 MB");

const title = `Large Upload ${Date.now()}`;
const form = new FormData();
form.set("file", new File([bytes], "large.pdf", { type: "application/pdf" }));
form.set("title", title);
const response = await fetch(`${base}/api/core/files?allowDuplicate=true`, { method: "POST", body: form, headers: auth });
assert.equal(response.status, 201, `a ${(bytes.length / 1048576).toFixed(0)} MB book uploads (got HTTP ${response.status})`);
const body = await response.json();
const id = body.document?.id;
assert.ok(id, "the upload names the new book");

const item = await (await fetch(`${base}/api/v1/items/${id}`, { headers: auth })).json();
const preservation = (item.item ?? item).preservation;
assert.equal(preservation.originalStored, true, "the original file is stored on the server");
assert.equal(preservation.sizeBytes, bytes.length, "all of it was stored, not just the first 10 MB");
console.log(`Large upload verified: a ${(bytes.length / 1048576).toFixed(0)} MB book is stored in full on the server.`);
