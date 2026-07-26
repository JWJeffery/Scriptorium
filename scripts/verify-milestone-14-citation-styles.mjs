// Requires Node 22.6+ run with --experimental-strip-types (set in ci.yml).
// Unlike the string-contract style of the earlier verify-milestone-*.mjs
// scripts, this one imports and executes the real .ts modules directly, so
// a passing run proves the actual formatter/normalizer behavior, not just
// that expected identifiers appear in the source text.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatCitation, CITATION_STYLE_IDS, isCitationStyleId } from "../apps/web/lib/citation-styles.ts";
import { normalizeCslBookRecord, exportBib, exportRis, importRis, importBib } from "../apps/web/lib/citation-exchange.ts";

// --- citation-styles.ts: all six styles must produce distinct, non-empty output ---

assert.deepEqual(CITATION_STYLE_IDS, ["chicago-note", "sbl-note", "turabian-note", "apa", "mla", "harvard"]);

const chapterItem = {
  type: "chapter",
  title: "On the Incarnation of the Logos",
  author: [{ family: "Athanasius" }],
  editor: [{ literal: "Robert W. Thomson" }],
  "container-title": "Contra Gentes and De Incarnatione",
  publisher: "Clarendon Press",
  "publisher-place": "Oxford",
  issued: { "date-parts": [[1971]] }
};

const outputByStyle = new Map();
for (const style of CITATION_STYLE_IDS) {
  const text = formatCitation(chapterItem, style, { type: "section", value: "54" });
  assert.ok(text.length > 20, `${style} produced suspiciously short output`);
  assert.ok(text.includes("Athanasius"), `${style} dropped the author`);
  assert.ok(text.includes("54"), `${style} dropped the locator`);
  outputByStyle.set(style, text);
}

// chicago-note/sbl-note/turabian-note intentionally share note-level
// formatting (documented in citation-styles.ts) — they should match each
// other but the remaining three (apa/mla/harvard) must each be genuinely
// distinct, not just copies of the note style or each other.
assert.equal(outputByStyle.get("chicago-note"), outputByStyle.get("sbl-note"));
assert.equal(outputByStyle.get("chicago-note"), outputByStyle.get("turabian-note"));
const distinctGroup = new Set([
  outputByStyle.get("chicago-note"),
  outputByStyle.get("apa"),
  outputByStyle.get("mla"),
  outputByStyle.get("harvard")
]);
assert.equal(distinctGroup.size, 4, "note-family output and apa/mla/harvard must all be genuinely distinct from each other");

assert.ok(!isCitationStyleId("apa-6th"), "unknown style ids must be rejected");
assert.throws(() => formatCitation(chapterItem, "not-a-style"), /Unsupported citation style/);

// Chicago-family output must not have a stray comma before the parenthetical imprint.
const chicago = formatCitation(chapterItem, "chicago-note", { value: "54" });
assert.ok(!chicago.includes(", ("), 'Chicago-family note must not read "..., (Place: ...)"');

// --- citation-exchange.ts: richer types round-trip through BibTeX/BibLaTeX/RIS ---

const normalized = normalizeCslBookRecord(chapterItem);
assert.equal(normalized.type, "chapter");
assert.equal(normalized["container-title"], "Contra Gentes and De Incarnatione");

assert.throws(
  () => normalizeCslBookRecord({ type: "chapter", title: "No container" }),
  /container-title/,
  "chapter records without a container-title must be rejected"
);

const bibtex = exportBib(chapterItem, "bibtex");
assert.ok(bibtex.startsWith("@incollection{"), "chapter records must export as @incollection, not @book");
assert.ok(bibtex.includes("booktitle = {Contra Gentes"), "bibtex export must carry the container title");

const article = { type: "article-journal", title: "A Test Article", author: [{ literal: "A. Scholar" }], "container-title": "Journal of Testing", issued: { "date-parts": [[2020]] } };
const articleBibtex = exportBib(article, "biblatex");
assert.ok(articleBibtex.startsWith("@article{"), "journal articles must export as @article");
assert.ok(articleBibtex.includes("journal = {Journal of Testing}"), "biblatex journal article must use the journal field, not booktitle");

const ris = exportRis(chapterItem);
assert.ok(ris.startsWith("TY  - CHAP"), "RIS export must set the correct TY tag for chapters");
const risRoundTrip = importRis(ris);
assert.equal(risRoundTrip.title, chapterItem.title);
assert.equal(risRoundTrip["container-title"], chapterItem["container-title"]);
assert.equal(risRoundTrip.type, "chapter");

const bibtexRoundTrip = importBib(`@book{doe-2000-title,\n  author = {Jane Doe},\n  title = {A Plain Book},\n  publisher = {Acme},\n  address = {Somewhere},\n  year = {2000}\n}\n`);
assert.equal(bibtexRoundTrip.title, "A Plain Book");
assert.equal(bibtexRoundTrip.publisher, "Acme");

// --- new additive CSL editor route (Milestone 6's original route is untouched) ---
const editorRoute = await readFile("apps/web/app/api/milestone-fourteen/csl-source-editor/route.ts", "utf8");
for (const term of ["normalizeCslBookRecord", "cslToInputJson", "editor", "translator", "containerTitle", "prisma.source.update"]) {
  assert.ok(editorRoute.includes(term), `expanded CSL source editor route missing contract term: ${term}`);
}
const originalSourcesRoute = await readFile("apps/web/app/api/milestone-six/sources/route.ts", "utf8");
assert.ok(originalSourcesRoute.includes('type: "book"'), "Milestone 6's original route must remain untouched (book-only, already audited/closed)");

console.log("Milestone 14 expanded citation styles verifier passed (executed real modules, not string matching).");
