import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("apps/web/app/api/milestone-thirteen/grounded-response/route.ts", "utf8");
const composer = await readFile("apps/web/lib/grounded-response.ts", "utf8");

for (const term of [
  "GroundedEvidence",
  "GroundedResponse",
  "buildGroundedResponse",
  "supported: false",
  "does not provide enough recovered passage evidence",
  "evidenceIds",
  "response:",
  "unsupported:"
]) {
  assert.ok(composer.includes(term), `grounded composer missing ${term}`);
}

for (const term of [
  "GET",
  "boundedQuery",
  "boundedLimit",
  "boundedCandidatePool",
  "q must be at least three characters",
  "Math.min(Math.max(parsed, 1), 8)",
  "Math.min(Math.max(parsed, 20), 300)",
  "prisma.textSpan.findMany",
  "prisma.annotation.findMany",
  "cosineSimilarity",
  "similaritySnippet",
  "buildGroundedResponse",
  "documentId",
  "sourceId",
  "annotationId",
  "citationId",
  "locator:",
  "prisma.queryLog.create",
  "mode: \"grounded-response\"",
  "passage-cited-local-v1"
]) {
  assert.ok(route.includes(term), `grounded response route missing ${term}`);
}

for (const forbidden of [
  "openai",
  "anthropic",
  "chat.completions",
  "responses.create",
  "uncited claim",
  "external ai"
]) {
  assert.ok(!route.toLowerCase().includes(forbidden.toLowerCase()), `grounded route must not include ${forbidden}`);
  assert.ok(!composer.toLowerCase().includes(forbidden.toLowerCase()), `grounded composer must not include ${forbidden}`);
}

const fixture = {
  query: "rule of prayer",
  limit: 4,
  evidence: [
    { id: "span-1", kind: "text-span", score: 0.72, documentId: "doc-1", sourceId: "src-1", locator: "page 12", snippet: "The rule of prayer orders the community's life." },
    { id: "ann-1", kind: "annotation-passage", score: 0.61, documentId: "doc-1", annotationId: "ann-1", citationId: "cit-1", locator: "page 13", snippet: "Prayer is treated as a disciplined daily practice." }
  ]
};

assert.ok(fixture.query.length >= 3, "grounded query must satisfy bounded query minimum");
assert.ok(fixture.limit <= 8, "grounded response evidence count must be bounded");
assert.ok(fixture.evidence.every((item) => item.score > 0), "grounded evidence must be positively scored");
assert.ok(fixture.evidence.every((item) => item.documentId && item.locator), "grounded evidence must remain source/locator inspectable");
assert.ok(fixture.evidence.every((item) => item.sourceId || item.annotationId || item.citationId), "grounded evidence must link to source or annotation/citation context");

console.log("Milestone 13 grounded response verifier passed.");
