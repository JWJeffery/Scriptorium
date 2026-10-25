import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import CSL from "citeproc";
import { parseAuthors, type CslName } from "./author-names.ts";

// Formats citations with citeproc-js and the official Citation Style Language
// style files in apps/web/csl (SBL, Chicago, APA, MLA, Harvard). The style files
// decide everything: first note in full, later notes shortened, which parts are
// italic, how authors are joined.

export type CitationStyleKey = "sbl-note" | "chicago-note" | "turabian-note" | "apa" | "mla" | "harvard";

const STYLE_FILES: Record<CitationStyleKey, { file: string; kind: "note" | "author-date" }> = {
  "sbl-note": { file: "society-of-biblical-literature-fullnote-bibliography.csl", kind: "note" },
  "chicago-note": { file: "chicago-notes-bibliography.csl", kind: "note" },
  // Turabian's notes-bibliography system is Chicago's; no separate Turabian file exists in the official CSL repository.
  "turabian-note": { file: "chicago-notes-bibliography.csl", kind: "note" },
  apa: { file: "apa.csl", kind: "author-date" },
  mla: { file: "modern-language-association.csl", kind: "author-date" },
  harvard: { file: "harvard-cite-them-right.csl", kind: "author-date" }
};

export function isStyleKey(value: unknown): value is CitationStyleKey {
  return typeof value === "string" && value in STYLE_FILES;
}

export function styleKind(style: CitationStyleKey) {
  return STYLE_FILES[style].kind;
}

function cslDirectory() {
  const candidates = [path.join(process.cwd(), "csl"), path.join(process.cwd(), "apps", "web", "csl"), path.join(path.dirname(new URL(import.meta.url).pathname), "..", "csl")];
  const found = candidates.find((candidate) => existsSync(path.join(candidate, "locales-en-US.xml")));
  if (!found) throw new Error("The citation style files (apps/web/csl) could not be found.");
  return found;
}

const styleCache = new Map<string, string>();
function readCsl(name: string) {
  let content = styleCache.get(name);
  if (content === undefined) {
    content = readFileSync(path.join(cslDirectory(), name), "utf8");
    styleCache.set(name, content);
  }
  return content;
}

export type CiteInput = {
  /** Same key = same source, so a later mention can be shortened. */
  key: string;
  csl: unknown;
  locator?: string;
  /** "page" for books and articles, "line" for plain-text documents. */
  label?: string;
};

export type FormattedCitation = { text: string; html: string };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#38;": "&", "&#60;": "<", "&#62;": ">", "&#34;": '"', "&#39;": "'", "&nbsp;": " ", "&#160;": " " };

/** Decode HTML entities, leaving spacing exactly as it is. */
export function decodeEntities(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (match, code: string) => ENTITIES[match] ?? String.fromCodePoint(Number(code)))
    .replace(/&(amp|lt|gt|quot|nbsp);/g, (match) => ENTITIES[match] ?? match);
}

export function htmlToText(html: string) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

type LooseCsl = Record<string, unknown> & { author?: unknown; editor?: unknown; translator?: unknown };

function namesOf(value: unknown): CslName[] | undefined {
  if (typeof value === "string") return parseAuthors(value);
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const name = entry as CslName;
    // Older records keep the whole name in `literal`; split it so short forms work.
    if (name.literal && !name.family && !name.given) {
      const braced = /^\{.*\}$/.test(name.literal.trim());
      return braced ? [{ literal: name.literal.trim().slice(1, -1) }] : parseAuthors(name.literal);
    }
    return [name];
  });
}

/** CSL JSON as the style engine needs it: structured names, an id, sensible defaults. */
export function normalizeCsl(raw: unknown, id: string) {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as LooseCsl;
  const item: Record<string, unknown> = { ...record, id, type: typeof record.type === "string" && record.type ? record.type : "book" };
  for (const field of ["author", "editor", "translator"] as const) {
    const names = namesOf(record[field]);
    if (names && names.length) item[field] = names;
    else delete item[field];
  }
  for (const key of Object.keys(item)) if (item[key] === undefined || item[key] === null || item[key] === "") delete item[key];
  const issued = item.issued as { "date-parts"?: unknown[][] } | undefined;
  if (issued && !Array.isArray(issued["date-parts"])) delete item.issued;
  return item;
}

function makeEngine(style: CitationStyleKey, items: Map<string, Record<string, unknown>>, format: "html" | "text" = "html") {
  const sys = {
    retrieveLocale: () => readCsl("locales-en-US.xml"),
    retrieveItem: (id: string) => items.get(id)
  };
  const engine = new CSL.Engine(sys, readCsl(STYLE_FILES[style].file), "en-US");
  engine.setOutputFormat(format);
  return engine;
}

/**
 * Format citations. `sequence` treats the inputs as consecutive notes in one
 * document (first mention full, later mentions shortened); `each` formats every
 * input as if it were the first and only citation.
 */
export function formatCitations(style: CitationStyleKey, inputs: CiteInput[], mode: "sequence" | "each" = "each"): FormattedCitation[] {
  const results: FormattedCitation[] = [];
  const run = (group: CiteInput[]) => {
    const items = new Map<string, Record<string, unknown>>();
    for (const input of group) if (!items.has(input.key)) items.set(input.key, normalizeCsl(input.csl, input.key));
    const engine = makeEngine(style, items);
    const done: Array<[string, number]> = [];
    group.forEach((input, index) => {
      const citation = {
        citationID: `c${index}`,
        citationItems: [{ id: input.key, ...(input.locator ? { locator: input.locator, label: input.label ?? "page" } : {}) }],
        properties: { noteIndex: styleKind(style) === "note" ? index + 1 : 0 }
      };
      const output = engine.processCitationCluster(citation, done.map((entry) => entry), []);
      done.push([citation.citationID, index + 1]);
      for (const [position, html] of output[1] as Array<[number, string, string]>) results[position] = { html, text: htmlToText(html) };
    });
  };
  if (mode === "sequence") {
    results.length = inputs.length;
    run(inputs);
    return results;
  }
  return inputs.map((input) => formatCitations(style, [input], "sequence")[0]);
}

/** Bibliography entries for a list of sources, in the style's order. */
export function formatBibliography(style: CitationStyleKey, sources: Array<{ key: string; csl: unknown }>): FormattedCitation[] {
  const items = new Map<string, Record<string, unknown>>();
  for (const source of sources) if (!items.has(source.key)) items.set(source.key, normalizeCsl(source.csl, source.key));
  const engine = makeEngine(style, items);
  engine.updateItems(Array.from(items.keys()));
  const [, entries] = engine.makeBibliography() as [unknown, string[]];
  return entries.map((entry) => ({ html: entry.trim(), text: htmlToText(entry) }));
}

const REQUIRED_FIELDS: Array<{ field: string; label: string; present: (item: Record<string, unknown>) => boolean }> = [
  { field: "author", label: "author", present: (item) => Array.isArray(item.author) && item.author.length > 0 },
  { field: "title", label: "title", present: (item) => typeof item.title === "string" && item.title.trim() !== "" },
  { field: "issued", label: "year", present: (item) => Boolean((item.issued as { "date-parts"?: unknown[][] } | undefined)?.["date-parts"]?.[0]?.[0]) },
  { field: "publisher", label: "publisher", present: (item) => typeof item.publisher === "string" && item.publisher.trim() !== "" }
];

/** What a citation will be missing, in words a person can act on. */
export function missingCitationFields(raw: unknown): string[] {
  const item = normalizeCsl(raw, "check");
  const book = item.type === "book" || item.type === "chapter";
  return REQUIRED_FIELDS.filter((entry) => (entry.field !== "publisher" || book) && !entry.present(item)).map((entry) => entry.label);
}
