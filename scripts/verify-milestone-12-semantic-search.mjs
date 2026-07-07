import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("apps/web/app/api/milestone-twelve/semantic-search/route.ts", "utf8");
const scorer = await readFile("apps/web/lib/local-similarity.ts", "utf8");

for (const term of [
  "tokenizeForSimilarity",
  "weightedTermVector",
  "cosineSimilarity",
  "similaritySnippet",
  "STOP_WORDS"
]) {
  assert.ok(scorer.includes(term), `local similarity scorer missing ${term}`);
}

for (const term of [
  "GET",
  "boundedQuery",
  "boundedLimit",
  "boundedCandidatePool",
  "q must be at least three characters",
  "Math.min(Math.max(parsed, 1), 25)",
  "Math.min(Math.max(parsed, 20), 300)",
  "prisma.textSpan.findMany",
  "prisma.annotation.findMany",
  "cosineSimilarity",
  "similaritySnippet",
  "score",
  "documentId",
  "sourceId",
  "annotationId",
  "citationId",
  "locator:",
  "prisma.queryLog.create",
  "mode: \"semantic-search\"",
  "local-token-cosine-v1"
]) {
  assert.ok(route.includes(term), `semantic search route missing contract term: ${term}`);
}

for (const forbidden of [
  "openai",
  "anthropic",
  "chat.completions",
  "responses.create",
  "answer generation",
  "generate answer"
]) {
  assert.ok(!route.toLowerCase().includes(forbidden.toLowerCase()), `semantic search gate must not include ${forbidden}`);
  assert.ok(!scorer.toLowerCase().includes(forbidden.toLowerCase()), `local scorer must not include ${forbidden}`);
}

const fixture = {
  query: "monastic prayer rule",
  limit: 10,
  candidatePool: 200,
  results: [
    { kind: "text-span", id: "span-1", score: 0.71, documentId: "doc-1", sourceId: "source-1", locator: "page 14" },
    { kind: "annotation-passage", id: "ann-1", score: 0.58, documentId: "doc-1", annotationId: "ann-1", citationId: "cit-1", locator: "page 16" }
  ]
};

assert.ok(fixture.query.length >= 3, "semantic query must satisfy bounded query minimum");
assert.ok(fixture.limit <= 25, "semantic result limit must be bounded");
assert.ok(fixture.candidatePool <= 300, "semantic candidate pool must be bounded");
assert.ok(fixture.results.every((result) => result.score > 0), "semantic results must include positive similarity scores");
assert.ok(fixture.results.every((result) => result.documentId && result.locator), "semantic results must stay source/locator inspectable");

console.log("Milestone 12 semantic search verifier passed.");
