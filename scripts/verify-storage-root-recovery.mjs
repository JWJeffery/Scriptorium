// Requires Node 22.6+ run with --experimental-strip-types.

import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const originalCwd = process.cwd();
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fakeRepo = await mkdtemp(path.join(tmpdir(), "scriptorium-storage-root-"));
const fakeWeb = path.join(fakeRepo, "apps", "web");
const storageKey = "documents/legacy-document/split-two-page-spreads.pdf";
const legacyPath = path.join(fakeWeb, "storage", storageKey);
const stablePath = path.join(fakeRepo, "storage", storageKey);

try {
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await writeFile(legacyPath, "%PDF-legacy-location");
  await mkdir(fakeWeb, { recursive: true });
  process.chdir(fakeWeb);
  process.env.SCRIPTORIUM_STORAGE_DIR = "./storage";

  const storage = await import(pathToFileURL(path.join(repoRoot, "apps", "web", "lib", "server-storage.ts")).href);
  assert.equal(storage.getStorageRoot(), path.join(fakeRepo, "storage"), "relative storage must resolve from the repository root");

  const recovered = await storage.readStoredPdfFile(storageKey);
  assert.equal(recovered.toString(), "%PDF-legacy-location", "reader must recover a PDF written under apps/web/storage");
  assert.equal((await readFile(stablePath, "utf8")), "%PDF-legacy-location", "legacy recovery must self-heal into stable storage");

  const manifest = await storage.listStoredFiles();
  assert.equal(manifest.filter((entry) => entry.storageKey === storageKey).length, 1, "legacy and healed copies must be one logical manifest entry");

  await storage.deleteStoredPdfFile(storageKey);
  await assert.rejects(access(legacyPath));
  await assert.rejects(access(stablePath));

  console.log("Storage-root recovery verifier passed (stable root, legacy fallback, self-heal, deduplication, and cleanup). ");
} finally {
  process.chdir(originalCwd);
  delete process.env.SCRIPTORIUM_STORAGE_DIR;
  await rm(fakeRepo, { recursive: true, force: true });
}
