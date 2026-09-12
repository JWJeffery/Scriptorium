import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, workspace, reader, tools, styles, pageSplitRoute, pageSplitImport] = await Promise.all([
  readFile(new URL("../apps/web/app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/components/ScriptoriumMilestoneOnePersisted.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/components/PdfAnchoredPageReader.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/components/ScholarlyToolsPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/app/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/app/api/milestone-seventeen/page-split/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/app/api/milestone-seventeen/page-split/import/route.ts", import.meta.url), "utf8")
]);

assert.match(page, /return <ScriptoriumMilestoneOnePersisted\s*\/>/,
  "The page must mount one state-owning Ledger workspace.");
assert.doesNotMatch(page, /ScholarlyToolsPanel/,
  "Scholarly tools must not be mounted a second time outside the drawer.");

for (const required of [
  "ledgerTopbar",
  "ledgerPane",
  "ledgerReader",
  "inspectorPane",
  "toolsDrawer",
  "ledgerStatus",
  "Clear browser annotation list",
  "Prior snapshot",
  "ScholarlyToolsPanel active={toolsOpen}"
]) {
  assert.ok(workspace.includes(required), `Ledger workspace is missing ${required}.`);
}

assert.match(reader, /pageCount\?: number/);
assert.match(reader, /onPageChange\?: \(pageNumber: number\) => void/);
assert.match(reader, /className="pdfPageControls"/,
  "PDF navigation must remain owned by the mounted reader toolbar.");
assert.match(tools, /window\.confirm\([\s\S]*reloads Scriptorium/,
  "Opening a split document must warn about losing an unsaved capture.");
assert.doesNotMatch(`${workspace}\n${tools}`, /\bGates?\s+\d/i,
  "Internal gate numbers must not appear in the user-facing application.");
assert.match(tools, /Load saved metadata/,
  "The expanded source editor must expose its saved-metadata load action.");
assert.match(tools, /citation-exchange\?sourceId=/,
  "The expanded source editor must retrieve the source's existing CSL metadata.");
assert.match(workspace, /formatCitation\(item, style/,
  "The annotation inspector must use the canonical selected-style formatter.");
assert.match(workspace, /function openAnnotationInspector\(\)[\s\S]*setInspectorOpen\(true\)[\s\S]*scrollIntoView[\s\S]*\.focus\(/,
  "The Annotate action must open and visibly focus the annotation form, including when the inspector is already pinned.");
assert.match(workspace, /aria-controls="annotation-inspector"/,
  "The Annotate action must identify the inspector it controls.");
for (const style of ["APA", "MLA", "Harvard"]) {
  assert.ok(workspace.includes(`>${style}<`), `The annotation inspector is missing the distinct ${style} option.`);
}
assert.match(pageSplitRoute, /alreadySplit/,
  "Page-split status must identify imported split output.");
assert.match(pageSplitRoute, /cannot be split again/,
  "The server must reject attempts to split an imported split output again.");
assert.match(pageSplitImport, /originalSource[\s\S]*cslJson/,
  "A split import must preserve the original source's saved CSL metadata.");

for (const required of [
  ".ledgerWorkspace.inspectorPinned .ledgerBody",
  ".ledgerWorkspace:not(.inspectorPinned) .inspectorPane",
  ".toolsDrawer.open",
  "@media (max-width: 1279px)",
  "@media (max-width: 1023px)",
  "@media (max-width: 700px)",
  "@media (prefers-reduced-motion: reduce)"
]) {
  assert.ok(styles.includes(required), `Ledger responsive CSS is missing ${required}.`);
}

console.log("Ledger UI contract verified: stable reader ownership, honest record actions, tools drawer, split warning, and responsive states are present.");
