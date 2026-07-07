import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const fixture = JSON.parse(await readFile("fixtures/milestone-4/text-snapshot-policy.json", "utf8"));
const routeSource = await readFile("apps/web/app/api/milestone-three/texts/route.ts", "utf8");
const storageSource = await readFile("apps/web/lib/server-storage.ts", "utf8");

function normalizeTextSnapshot(rawText) {
  return rawText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function checksum(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function lineForOffset(text, offset) {
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

assert.ok(fixture.document?.id, "fixture must name a document id");
assert.ok(Array.isArray(fixture.versions), "fixture.versions must be an array");
assert.equal(fixture.versions.length, 2, "snapshot policy fixture must include initial import plus reimport");
assert.ok(Array.isArray(fixture.annotations), "fixture.annotations must be an array");
assert.equal(fixture.annotations.length, 1, "fixture must include an annotation tied to the first snapshot");

const seenChecksums = new Set();
const seenSnapshotKeys = new Set();
for (const version of fixture.versions) {
  assert.ok(version.id, "each version must have an id");
  assert.ok(Number.isInteger(version.ordinal), `${version.id} must have integer ordinal`);
  const normalized = normalizeTextSnapshot(version.rawText);
  assert.equal(normalized, version.normalizedText, `${version.id} normalized text mismatch`);
  assert.equal(checksum(normalized), version.sourceChecksum, `${version.id} checksum must be sha256(normalized text)`);
  assert.equal(version.snapshotKey, `documents/${fixture.document.id}/snapshots/${version.sourceChecksum}.txt`, `${version.id} snapshotKey must be checksum-addressed`);
  assert.equal(normalized.split("\n").length, version.lineCount, `${version.id} line count mismatch`);
  assert.ok(!seenChecksums.has(version.sourceChecksum), `${version.id} checksum must be unique across changed snapshots`);
  assert.ok(!seenSnapshotKeys.has(version.snapshotKey), `${version.id} snapshotKey must be unique across changed snapshots`);
  seenChecksums.add(version.sourceChecksum);
  seenSnapshotKeys.add(version.snapshotKey);
}

const [firstVersion, secondVersion] = fixture.versions;
const annotation = fixture.annotations[0];
assert.equal(annotation.documentId, fixture.document.id, "annotation must remain tied to the document");
assert.equal(annotation.versionId, firstVersion.id, "annotation must remain tied to the original version after reimport");
assert.equal(annotation.snapshotKey, firstVersion.snapshotKey, "annotation must preserve original snapshot key");
assert.notEqual(annotation.versionId, fixture.expectedCurrentVersionIdAfterReimport, "old annotation must not be retargeted to the current version");
assert.equal(firstVersion.normalizedText.slice(annotation.anchor.startOffset, annotation.anchor.endOffset), annotation.selectedText, "annotation must recover from the original normalized snapshot");
assert.notEqual(secondVersion.normalizedText.slice(annotation.anchor.startOffset, annotation.anchor.endOffset), annotation.selectedText, "annotation offsets must not be silently projected onto the reimported snapshot");
assert.equal(lineForOffset(firstVersion.normalizedText, annotation.anchor.startOffset), annotation.anchor.lineStart, "lineStart must derive from original snapshot offsets");
assert.equal(lineForOffset(firstVersion.normalizedText, annotation.anchor.endOffset), annotation.anchor.lineEnd, "lineEnd must derive from original snapshot offsets");
assert.equal(annotation.locatorType, "line", "text snapshot annotations must use line locators");
assert.equal(annotation.locatorValue, String(annotation.anchor.lineStart), "locatorValue must derive from lineStart for single-line selections");

assert.ok(storageSource.includes("normalizeTextSnapshot"), "storage helper must expose deterministic text normalization");
assert.ok(storageSource.includes("textSnapshotChecksum"), "storage helper must expose checksum generation");
assert.ok(storageSource.includes("storeTextSnapshot"), "storage helper must store text snapshots");
assert.ok(routeSource.includes("sourceChecksum"), "TXT/Markdown route must persist DocumentVersion.sourceChecksum");
assert.ok(routeSource.includes("snapshotKey"), "TXT/Markdown route must persist DocumentVersion.snapshotKey");
assert.ok(routeSource.includes("documentVersion.count"), "TXT/Markdown route must create version ordinals instead of overwriting versions");
assert.ok(routeSource.includes("findReusableDocument"), "TXT/Markdown route must support reimporting an existing document as a new version");

console.log("Milestone 4 snapshot policy verified: normalization, checksum-addressed snapshots, versioning, and annotation/version isolation are coherent.");
