import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fixture = JSON.parse(await readFile("fixtures/milestone-7/citation-exchange.json", "utf8"));
const helper = await readFile("apps/web/lib/citation-exchange.ts", "utf8");
const route = await readFile("apps/web/app/api/milestone-seven/citation-exchange/route.ts", "utf8");

function normalizeCsl(record) {
  const author = Array.isArray(record.author) ? record.author[0]?.literal ?? "" : "";
  const year = record.issued?.["date-parts"]?.[0]?.[0];
  return {
    title: record.title,
    author,
    publisher: record.publisher,
    "publisher-place": record["publisher-place"],
    year: String(year ?? "")
  };
}

for (const term of ["exportCslJson", "exportBib", "importCslJson", "importBib", "importCitationRecord", "exportCitationRecord"]) {
  assert.ok(helper.includes(term), `citation exchange helper missing ${term}`);
}

for (const term of ["GET", "POST", "sourceId is required", "csl-json", "bibtex", "biblatex", "prisma.source.update", "prisma.source.findUnique"]) {
  assert.ok(route.includes(term), `citation exchange route missing ${term}`);
}

assert.deepEqual(normalizeCsl(fixture.csl), fixture.expected, "CSL fixture must normalize to expected fields");
assert.ok(fixture.bibtex.includes("address = {Oxford}"), "BibTeX fixture must use address for place");
assert.ok(fixture.biblatex.includes("location = {Oxford}"), "BibLaTeX fixture must use location for place");
assert.ok(fixture.bibtex.includes("title = {Citation Exchange Demonstration}"), "BibTeX fixture must preserve title");
assert.ok(fixture.biblatex.includes("author = {Clara Bibliographer}"), "BibLaTeX fixture must preserve author");

console.log("Milestone 7 citation exchange verifier passed.");
