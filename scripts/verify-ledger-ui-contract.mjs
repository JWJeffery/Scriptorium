import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, workspace, reader, tools, styles] = await Promise.all([
  readFile(new URL("../apps/web/app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/components/ScriptoriumMilestoneOnePersisted.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/components/PdfAnchoredPageReader.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/components/ScholarlyToolsPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/app/styles.css", import.meta.url), "utf8")
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
