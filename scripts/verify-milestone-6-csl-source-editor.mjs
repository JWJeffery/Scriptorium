import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("apps/web/app/api/milestone-six/sources/route.ts", "utf8");
const component = await readFile("apps/web/components/ScriptoriumMilestoneOnePersisted.tsx", "utf8");

const requiredRouteTerms = [
  "PATCH",
  "sourceId is required",
  "A CSL source title is required",
  "Year must be a 1-4 digit year",
  "shortTitle",
  "cslJson",
  "publisher-place",
  "date-parts",
  "prisma.source.update"
];

const requiredComponentTerms = [
  "/api/milestone-six/sources",
  "Save CSL source metadata",
  "validateSource",
  "persistSourceMetadata",
  "Saved CSL-compatible source metadata to the database",
  "generatedCitation"
];

for (const term of requiredRouteTerms) {
  assert.ok(route.includes(term), `CSL source route missing ${term}`);
}

for (const term of requiredComponentTerms) {
  assert.ok(component.includes(term), `CSL source editor component missing ${term}`);
}

assert.ok(route.includes("type: \"book\""), "CSL route must persist a book-shaped CSL record for this gate");
assert.ok(component.includes("citation(documentRecord, locator, style)"), "Generated citation must continue to derive from edited local source metadata");

console.log("Milestone 6 CSL source editor verifier passed.");
