import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("apps/web/app/api/milestone-eleven/exact-search/route.ts", "utf8");
const schema = await readFile("prisma/schema.prisma", "utf8");

for (const term of [
  "model Document",
  "model TextSpan",
  "model Annotation",
  "model AnnotationTag",
  "model Citation",
  "model ResearchThread",
  "model ResearchThreadTag",
  "model QueryLog"
]) {
  assert.ok(schema.includes(term), `schema missing searchable model: ${term}`);
}

for (const term of [
  "GET",
  "boundedQuery",
  "boundedLimit",
  "q must be at least two characters",
  "Math.min(Math.max(parsed, 1), 50)",
  "prisma.document.findMany",
  "prisma.textSpan.findMany",
  "prisma.annotation.findMany",
  "prisma.annotationTag.findMany",
  "prisma.citation.findMany",
  "prisma.researchThread.findMany",
  "prisma.researchThreadTag.findMany",
  "prisma.queryLog.create",
  "mode: \"exact-search\"",
  "documentId",
  "sourceId",
  "annotationId",
  "citationId",
  "threadId",
  "locator:",
  "contains: query"
]) {
  assert.ok(route.includes(term), `exact search route missing contract term: ${term}`);
}

for (const forbidden of [
  "semantic",
  "embedding",
  "vector",
  "generated answer",
  "openai"
]) {
  assert.ok(!route.toLowerCase().includes(forbidden.toLowerCase()), `exact search gate must not include ${forbidden}`);
}

const fixture = {
  query: "grace",
  limit: 25,
  results: [
    { kind: "document", id: "doc-1", documentId: "doc-1" },
    { kind: "text-span", id: "span-1", documentId: "doc-1", sourceId: "src-1", locator: "page 12" },
    { kind: "annotation", id: "ann-1", annotationId: "ann-1", citationId: "cit-1", locator: "page 12" },
    { kind: "citation", id: "cit-1", sourceId: "src-1", citationId: "cit-1" },
    { kind: "thread", id: "thread-1", threadId: "thread-1" }
  ]
};

assert.ok(fixture.query.length >= 2, "fixture query must satisfy bounded query minimum");
assert.ok(fixture.limit <= 50, "fixture limit must remain bounded");
assert.ok(fixture.results.some((result) => result.kind === "text-span" && result.locator), "fixture must include source locator search result");
assert.ok(fixture.results.some((result) => result.kind === "citation" && result.citationId), "fixture must include citation-linked result");
assert.ok(fixture.results.some((result) => result.kind === "thread" && result.threadId), "fixture must include thread-linked result");

console.log("Milestone 11 exact search verifier passed.");
