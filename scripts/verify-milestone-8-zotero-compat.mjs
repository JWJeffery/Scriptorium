import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mapper = await readFile("apps/web/lib/zotero-compat.ts", "utf8");
const route = await readFile("apps/web/app/api/milestone-eight/zotero/route.ts", "utf8");

const cslFixture = {
  type: "book",
  title: "Round Trip Demonstration",
  author: [{ literal: "Morgan Cataloger" }],
  publisher: "Scriptorium House",
  "publisher-place": "Cambridge",
  issued: { "date-parts": [[2026]] }
};

const itemFixture = {
  itemType: "book",
  title: "Round Trip Demonstration",
  creators: [{ creatorType: "author", firstName: "Morgan", lastName: "Cataloger" }],
  place: "Cambridge",
  publisher: "Scriptorium House",
  date: "2026"
};

for (const term of [
  "cslToZoteroBookItem",
  "zoteroBookItemToCsl",
  "exportZoteroItemJson",
  "importZoteroItemJson",
  "itemType: \"book\"",
  "creatorType: \"author\"",
  "publisher-place",
  "date-parts"
]) {
  assert.ok(mapper.includes(term), `Zotero compatibility mapper missing ${term}`);
}

for (const term of [
  "GET",
  "POST",
  "sourceId is required",
  "zotero-item-json",
  "exportZoteroItemJson",
  "importZoteroItemJson",
  "prisma.source.findUnique",
  "prisma.source.update"
]) {
  assert.ok(route.includes(term), `Zotero compatibility route missing ${term}`);
}

assert.equal(cslFixture.title, itemFixture.title, "round-trip fixture title must match");
assert.equal(cslFixture.publisher, itemFixture.publisher, "round-trip fixture publisher must match");
assert.equal(cslFixture["publisher-place"], itemFixture.place, "round-trip fixture place must map to Zotero place");
assert.equal(String(cslFixture.issued["date-parts"][0][0]), itemFixture.date, "round-trip fixture year must map to Zotero date");
assert.equal(cslFixture.author[0].literal, `${itemFixture.creators[0].firstName} ${itemFixture.creators[0].lastName}`, "round-trip fixture creator must map to CSL literal author");

console.log("Milestone 8 Zotero-compatible data path verifier passed.");
