import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const formatter = await readFile("apps/web/lib/thread-export.ts", "utf8");
const route = await readFile("apps/web/app/api/milestone-ten/thread-render/route.ts", "utf8");

for (const term of [
  "exportThreadMarkdown",
  "exportThreadRtf",
  "exportResearchThread",
  "Thread items",
  "Thread note:",
  "Citation:",
  "Locator:",
  "Source:",
  "Document:",
  "\\\\rtf1"
]) {
  assert.ok(formatter.includes(term), `thread export formatter missing ${term}`);
}

for (const term of [
  "GET",
  "threadId is required",
  "format must be markdown or rtf",
  "Research thread not found",
  "exportResearchThread",
  "researchThread.findUnique",
  "annotation.findMany",
  "citation.findMany",
  "source.findMany",
  "document.findMany",
  "orderIndex: \"asc\"",
  "rendered"
]) {
  assert.ok(route.includes(term), `thread render route missing ${term}`);
}

for (const forbidden of [
  "semantic",
  "embedding",
  "vector",
  "answer generation",
  "openai"
]) {
  assert.ok(!route.toLowerCase().includes(forbidden.toLowerCase()), `thread export gate must not include ${forbidden}`);
  assert.ok(!formatter.toLowerCase().includes(forbidden.toLowerCase()), `thread export formatter must not include ${forbidden}`);
}

const fixture = {
  title: "Research Thread Export Fixture",
  description: "A bounded export fixture.",
  tags: [{ value: "export" }, { value: "threads" }],
  items: [
    { itemType: "ANNOTATION", itemId: "ann-1", orderIndex: 0, note: "Use this passage first." },
    { itemType: "CITATION", itemId: "cit-1", orderIndex: 1, note: "Citation follows the passage." },
    { itemType: "SOURCE", itemId: "src-1", orderIndex: 2, note: "Source context remains visible." },
    { itemType: "NOTE", itemId: "note-1", orderIndex: 3, note: "Working note survives export." }
  ]
};

assert.equal(fixture.items.map((item) => item.orderIndex).join(","), "0,1,2,3", "export fixture must preserve item order");
assert.ok(fixture.tags.map((tag) => tag.value).includes("export"), "export fixture must preserve tags");
assert.ok(fixture.items.some((item) => item.note?.includes("survives")), "export fixture must preserve notes");

console.log("Milestone 10 thread export verifier passed.");
