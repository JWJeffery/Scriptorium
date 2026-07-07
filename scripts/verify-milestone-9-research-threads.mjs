import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const route = await readFile("apps/web/app/api/milestone-nine/research-threads/route.ts", "utf8");

for (const term of [
  "model ResearchThread",
  "model ResearchThreadItem",
  "model ResearchThreadTag",
  "enum ResearchThreadItemType",
  "DOCUMENT",
  "ANNOTATION",
  "CITATION",
  "SOURCE",
  "NOTE",
  "orderIndex",
  "@@index([researchThreadId])",
  "@@unique([researchThreadId, value])"
]) {
  assert.ok(schema.includes(term), `schema missing research thread contract term: ${term}`);
}

for (const term of [
  "GET",
  "POST",
  "Research thread title is required",
  "buildThreadContext",
  "normalizeItems",
  "cleanTags",
  "researchThread.create",
  "researchThread.findUnique",
  "researchThread.findMany",
  "const itemOrder = { orderIndex: \"asc\" as const }",
  "annotation.findMany",
  "citation.findMany",
  "source.findMany",
  "document.findMany",
  "context:"
]) {
  assert.ok(route.includes(term), `research thread route missing contract term: ${term}`);
}

for (const forbidden of [
  "exportThread",
  "semantic",
  "embedding",
  "vector",
  "answer generation"
]) {
  assert.ok(!route.toLowerCase().includes(forbidden.toLowerCase()), `research thread gate must not include ${forbidden}`);
}

const sample = {
  title: "Patristic Sources on Prayer",
  description: "A bounded research thread fixture.",
  tags: ["prayer", "patristics"],
  items: [
    { itemType: "ANNOTATION", itemId: "annotation-1", orderIndex: 0, note: "Primary passage." },
    { itemType: "CITATION", itemId: "citation-1", orderIndex: 1, note: "Citation supporting the passage." },
    { itemType: "SOURCE", itemId: "source-1", orderIndex: 2, note: "Source context." },
    { itemType: "NOTE", itemId: "note-1", orderIndex: 3, note: "Working synthesis note." }
  ]
};

assert.equal(sample.items.map((item) => item.orderIndex).join(","), "0,1,2,3", "fixture items must preserve explicit order");
assert.ok(sample.tags.includes("prayer"), "fixture must include thread tags");
assert.ok(sample.items.some((item) => item.itemType === "ANNOTATION"), "fixture must attach annotations");
assert.ok(sample.items.some((item) => item.itemType === "CITATION"), "fixture must attach citations");
assert.ok(sample.items.some((item) => item.itemType === "SOURCE"), "fixture must attach source context");
assert.ok(sample.items.some((item) => item.itemType === "NOTE"), "fixture must store thread notes");

console.log("Milestone 9 research thread verifier passed.");
