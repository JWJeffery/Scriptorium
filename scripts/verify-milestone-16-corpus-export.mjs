// Requires Node 22.6+ run with --experimental-strip-types.
//
// The export route itself needs a live Prisma client/database; this
// verifier instead executes the real, DB-independent half of the feature
// (the on-disk storage manifest) against a throwaway directory tree, and
// contract-checks the route source for the parts that need a database.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

const tempRoot = await mkdtemp(path.join(tmpdir(), "scriptorium-export-test-"));
process.env.SCRIPTORIUM_STORAGE_DIR = tempRoot;

await mkdir(path.join(tempRoot, "documents", "doc-1", "snapshots"), { recursive: true });
await writeFile(path.join(tempRoot, "documents", "doc-1", "source.pdf"), "pdf-bytes");
await writeFile(path.join(tempRoot, "documents", "doc-1", "snapshots", "deadbeef.txt"), "snapshot text");

const { listStoredFiles } = await import("../apps/web/lib/server-storage.ts");
const manifest = await listStoredFiles();

assert.equal(manifest.length, 2, "manifest must include every file under the storage root, recursively");
assert.ok(manifest.some((entry) => entry.storageKey === "documents/doc-1/source.pdf"), "manifest must include the PDF original");
assert.ok(manifest.some((entry) => entry.storageKey === "documents/doc-1/snapshots/deadbeef.txt"), "manifest must include nested snapshot files");
assert.ok(manifest.every((entry) => typeof entry.size === "number" && entry.size > 0), "manifest entries must report a real file size");
assert.ok(manifest.every((entry) => !Number.isNaN(Date.parse(entry.modifiedAt))), "manifest entries must report a parseable modification time");

await rm(tempRoot, { recursive: true, force: true });

const route = await readFile("apps/web/app/api/milestone-fifteen/corpus-export/route.ts", "utf8");
for (const term of [
  "listStoredFiles",
  "storageManifest",
  "prisma.document.findMany",
  "prisma.source.findMany",
  "prisma.researchThread.findMany",
  "schemaVersion",
  "exportedAt"
]) {
  assert.ok(route.includes(term), `corpus export route missing contract term: ${term}`);
}
assert.ok(!route.includes("prisma.queryLog.findMany"), "corpus export intentionally excludes queryLog telemetry");

console.log("Milestone 16 corpus export verifier passed.");
