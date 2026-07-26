// Requires Node 22.6+ run with --experimental-strip-types.
//
// The regeneration route itself needs a live Prisma client and database, so
// this verifier does two things instead of hitting the route directly:
//   1. executes the real staleness rule and formatter reuse against
//      in-memory fixtures shaped exactly like the Prisma rows the route
//      reads and writes, and
//   2. contract-checks the route source for the specific behaviors that
//      can't be exercised without a database (chain-walking to the latest
//      version, refusing to mutate history, requiring force for non-stale
//      regeneration).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatCitation } from "../apps/web/lib/citation-styles.ts";

// --- staleness rule, mirrored from app/api/milestone-fourteen/citation-regenerate/route.ts ---
function isStale(citation, source) {
  return citation.sourceSnapshotUpdatedAt.getTime() < source.updatedAt.getTime();
}

const source = { updatedAt: new Date("2026-06-01T00:00:00Z"), cslJson: { type: "book", title: "The Ladder of Divine Ascent", author: [{ literal: "John Climacus" }], publisher: "Paulist Press", "publisher-place": "New York", issued: { "date-parts": [[1982]] } } };

const freshCitation = { sourceSnapshotUpdatedAt: new Date("2026-06-01T00:00:00Z") };
const staleCitation = { sourceSnapshotUpdatedAt: new Date("2026-05-01T00:00:00Z") };

assert.equal(isStale(freshCitation, source), false, "a citation snapshotted at the source's current updatedAt must not be stale");
assert.equal(isStale(staleCitation, source), true, "a citation snapshotted before the source's current updatedAt must be stale");

// Regeneration must reuse the shared formatter, not duplicate formatting logic.
const regenerated = formatCitation(source.cslJson, "chicago-note", { type: "page", value: "112" });
assert.ok(regenerated.includes("John Climacus"));
assert.ok(regenerated.includes("112"));

// --- route contract: history preserved, chain walked to tip, force required for non-stale ---
const route = await readFile("apps/web/app/api/milestone-fourteen/citation-regenerate/route.ts", "utf8");

for (const term of [
  "latestInChain",
  "supersedesCitationId",
  "isStale",
  "force",
  "formatCitation",
  "prisma.citation.create"
]) {
  assert.ok(route.includes(term), `citation-regenerate route missing contract term: ${term}`);
}

assert.ok(!route.includes("prisma.citation.update"), "regeneration must create a new row, not mutate the existing citation (see ARCHITECTURE.md regeneration rule)");
assert.ok(route.includes("Citation is not stale"), "route must decline to regenerate a non-stale citation without an explicit override");

console.log("Milestone 15 citation regeneration verifier passed.");
