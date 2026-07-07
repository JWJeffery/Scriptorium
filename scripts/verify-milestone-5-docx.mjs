import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("apps/web/app/api/milestone-five/docx/route.ts", "utf8");
const helper = await readFile("apps/web/lib/docx-extraction.ts", "utf8");
const pkg = await readFile("apps/web/package.json", "utf8");

const requiredRouteTerms = [
  "DOCX",
  "extractDocxRawText",
  "storeTextSnapshot",
  "sourceChecksum",
  "snapshotKey",
  "documentVersion.count",
  "TEXT_EXTRACTION",
  "textSpan.create"
];

assert.ok(pkg.includes("mammoth"), "DOCX extraction dependency must be declared");
assert.ok(helper.includes("extractRawText"), "DOCX helper must extract raw text");
assert.ok(helper.includes("DOCX extraction produced no readable text"), "DOCX helper must reject empty extraction");

for (const term of requiredRouteTerms) {
  assert.ok(route.includes(term), `DOCX route missing ${term}`);
}

console.log("Milestone 5 DOCX contract verified.");
