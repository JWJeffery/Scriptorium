// Live API smoke test. The caller must start the built Next.js app against
// a migrated MySQL database before running this script.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createCanvas } = requireFromWeb("@napi-rs/canvas");
const { PDFDocument } = requireFromWeb("pdf-lib");
const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3100";

async function json(response) {
  const body = await response.json();
  assert.ok(response.ok, `${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  return body;
}

function syntheticSpreadPdf() {
  return (async () => {
    const width = 1200;
    const height = 1600;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "black";
    for (let y = 45, line = 0; y < height - 35; y += 22, line += 1) {
      context.fillRect(45 + (line % 3) * 5, y, 390 + (line % 5) * 19, 5);
      context.fillRect(690 + (line % 4) * 4, y, 400 + ((line + 2) % 6) * 17, 5);
    }

    const pdf = await PDFDocument.create();
    const image = await pdf.embedJpg(canvas.toBuffer("image/jpeg", 92));
    const page = pdf.addPage([width / 2, height / 2]);
    page.drawImage(image, { x: 0, y: 0, width: width / 2, height: height / 2 });
    return await pdf.save();
  })();
}

const sourceBytes = await syntheticSpreadPdf();
const sourceForm = new FormData();
sourceForm.set("file", new File([sourceBytes], "ci-two-page-spread.pdf", { type: "application/pdf" }));
sourceForm.set("title", "CI two-page spread");
const uploaded = await json(await fetch(`${baseUrl}/api/milestone-one/files`, { method: "POST", body: sourceForm }));
assert.ok(uploaded.document?.id && uploaded.version?.id && uploaded.source?.id && uploaded.pageMap?.id);

const started = await json(
  await fetch(`${baseUrl}/api/milestone-seventeen/page-split`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId: uploaded.version.id })
  })
);
assert.equal(started.splitStarted, true);

let splitResult;
for (let attempt = 0; attempt < 120; attempt += 1) {
  const status = await json(
    await fetch(`${baseUrl}/api/milestone-seventeen/page-split?documentId=${encodeURIComponent(uploaded.document.id)}`)
  );
  splitResult = status.results?.find((result) => result.versionId === uploaded.version.id);
  if (splitResult?.splitReady || splitResult?.splitFailed) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}

assert.ok(splitResult, "uploaded PDF version must appear in split status");
assert.equal(splitResult.splitFailed, false, splitResult.splitError ?? "split failed");
assert.equal(splitResult.splitReady, true, "split did not finish within 30 seconds");
assert.deepEqual(splitResult.splitSummary.splitOriginalPageNumbers, [1]);
assert.equal(splitResult.splitSummary.newPageCount, 2);

const download = await fetch(
  `${baseUrl}/api/milestone-seventeen/page-split/download?versionId=${encodeURIComponent(uploaded.version.id)}`
);
assert.equal(download.status, 200);
assert.match(download.headers.get("content-type") ?? "", /^application\/pdf/);
const splitBytes = new Uint8Array(await download.arrayBuffer());
const splitPdf = await PDFDocument.load(splitBytes);
assert.equal(splitPdf.getPageCount(), 2, "download must contain two physical PDF pages");

const imported = await json(
  await fetch(`${baseUrl}/api/milestone-seventeen/page-split/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId: uploaded.version.id, title: "CI two-page spread (split)" })
  })
);
assert.notEqual(imported.document.id, uploaded.document.id, "import must create a new document and preserve the original");

const reopened = await json(
  await fetch(`${baseUrl}/api/milestone-one/workspace?documentId=${encodeURIComponent(imported.document.id)}`)
);
assert.equal(reopened.document.id, imported.document.id);
assert.equal(reopened.document.versions[0].id, imported.version.id);
assert.ok(reopened.document.versions[0].snapshotKey, "new document must retain its server PDF snapshot");

console.log("Page-split API smoke test passed (upload, background split, status, PDF download, new-document import, and reopen). ");
