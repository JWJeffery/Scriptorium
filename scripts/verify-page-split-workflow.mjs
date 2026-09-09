// Requires Node 22.6+ run with --experimental-strip-types.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const jobsModuleUrl = pathToFileURL(join(repoRoot, "apps/web/lib/page-split-jobs.ts")).href;

// A separate process proves that completed state is genuinely recoverable
// from disk rather than accidentally surviving in the importing process's
// module cache. It also lets the parent verify that beginJob removes an old
// ready record before a re-run starts.
if (process.argv[2] === "--read-job") {
  const { getJob } = await import(jobsModuleUrl);
  const state = await getJob(process.argv[3]);
  process.stdout.write(JSON.stringify(state ?? null));
  process.exit(0);
}

const scratchRoot = await mkdtemp(join(tmpdir(), "scriptorium-page-split-verifier-"));
process.env.SCRIPTORIUM_STORAGE_DIR = join(scratchRoot, "storage");

try {
  const jobs = await import(jobsModuleUrl);
  const versionId = "verification-version";
  const readyState = {
    status: "ready",
    progress: null,
    resultStorageKey: "documents/verification/split-two-page-spreads.pdf",
    originalPageCount: 1,
    newPageCount: 2,
    splitOriginalPageNumbers: [1]
  };

  await jobs.setFinishedJob(versionId, readyState);

  const readInChild = () =>
    spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), "--read-job", versionId], {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8"
    });

  const recovered = readInChild();
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(JSON.parse(recovered.stdout), readyState, "completed split state must survive a separate process");

  await jobs.beginJob(versionId);
  assert.equal((await jobs.getJob(versionId))?.status, "running", "the active process must see the new run");

  const afterRestart = readInChild();
  assert.equal(afterRestart.status, 0, afterRestart.stderr);
  assert.equal(JSON.parse(afterRestart.stdout), null, "a re-run must not resurrect the previous ready result after reload");

  const requireFromWeb = createRequire(join(repoRoot, "apps/web/package.json"));
  const { createCanvas } = requireFromWeb("@napi-rs/canvas");
  const { PDFDocument } = requireFromWeb("pdf-lib");
  const { splitTwoPageSpreadPdf } = await import(pathToFileURL(join(repoRoot, "apps/web/lib/pdf-page-splitter.ts")).href);

  // Build one realistic image-backed spread: dense, uneven horizontal
  // strokes on both halves and a continuous white spine gutter. This runs
  // the real production splitter, including its isolated child process,
  // physical JPEG crops, and final PDF construction.
  const width = 1200;
  const height = 1600;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "black";
  for (let y = 45, line = 0; y < height - 35; y += 22, line += 1) {
    const leftWidth = 390 + (line % 5) * 19;
    const rightWidth = 400 + ((line + 2) % 6) * 17;
    context.fillRect(45 + (line % 3) * 5, y, leftWidth, 5);
    context.fillRect(690 + (line % 4) * 4, y, rightWidth, 5);
  }

  const source = await PDFDocument.create();
  const image = await source.embedJpg(canvas.toBuffer("image/jpeg", 92));
  const page = source.addPage([width / 2, height / 2]);
  page.drawImage(image, { x: 0, y: 0, width: width / 2, height: height / 2 });

  const progress = [];
  const split = await splitTwoPageSpreadPdf(await source.save(), (completed, total) => progress.push({ completed, total }));
  assert.equal(split.originalPageCount, 1);
  assert.equal(split.newPageCount, 2);
  assert.deepEqual(split.splitOriginalPageNumbers, [1]);
  assert.deepEqual(progress, [{ completed: 1, total: 1 }]);

  const output = await PDFDocument.load(split.pdfBytes);
  assert.equal(output.getPageCount(), 2);
  const [left, right] = output.getPages();
  assert.ok(left.getWidth() > 200 && right.getWidth() > 200, "both physical crop pages must contain substantial content");
  assert.ok(Math.abs(left.getHeight() - right.getHeight()) < 0.01, "both crop pages must preserve the source height");

  await jobs.clearJob(versionId);
  console.log("Page-split workflow verifier passed (durable state, stale-state invalidation, isolated detection, and physical two-page output). ");
} finally {
  await rm(scratchRoot, { recursive: true, force: true });
}
