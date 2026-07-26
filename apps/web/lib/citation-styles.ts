// Canonical citation formatting module.
//
// This is the single place citation text is generated from CSL-shaped source
// metadata. It must be usable from both server routes (regeneration,
// exchange) and, eventually, the client workspace, so it has no Prisma or
// Next.js imports — pure data in, string out.
//
// Scope: extends the original book-only, two-style model with richer item
// types (chapter, article-journal, manuscript) and four additional styles
// (Turabian, APA, MLA, Harvard) called out as "high-priority later styles"
// in docs/CITATION_ENGINE.md.

export type CitationStyleId = "chicago-note" | "sbl-note" | "turabian-note" | "apa" | "mla" | "harvard";

export const CITATION_STYLE_IDS: CitationStyleId[] = ["chicago-note", "sbl-note", "turabian-note", "apa", "mla", "harvard"];

export type CslItemType = "book" | "chapter" | "article-journal" | "manuscript";

export type CslName = { literal?: string; family?: string; given?: string };

export type CslItem = {
  type?: CslItemType;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  translator?: CslName[];
  "container-title"?: string;
  "collection-title"?: string;
  publisher?: string;
  "publisher-place"?: string;
  volume?: string;
  edition?: string;
  issued?: { "date-parts"?: Array<Array<string | number>> };
};

export type Locator = { type?: string; value?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nameToLiteral(name: CslName | undefined) {
  if (!name) return "";
  if (name.literal) return clean(name.literal);
  return [name.given, name.family].filter(Boolean).map(clean).join(" ").trim();
}

function nameToInverted(name: CslName | undefined) {
  if (!name) return "";
  if (name.literal) return clean(name.literal);
  const family = clean(name.family);
  const given = clean(name.given);
  if (family && given) return `${family}, ${given}`;
  return family || given;
}

export function firstName(item: CslItem, field: "author" | "editor" | "translator" = "author") {
  return item[field]?.[0];
}

export function itemYear(item: CslItem) {
  const value = item.issued?.["date-parts"]?.[0]?.[0];
  return value === undefined || value === null || value === "" ? "" : String(value);
}

function itemTitle(item: CslItem) {
  return clean(item.title) || "Untitled source";
}

function locatorPhrase(locator: Locator | undefined, style: "note" | "parenthetical") {
  const type = clean(locator?.type) || "page";
  const value = clean(locator?.value);
  if (!value) return "";
  if (style === "note") {
    if (type === "page") return value;
    return `${type} ${value}`;
  }
  const abbrev: Record<string, string> = { page: "p.", paragraph: "para.", section: "sec.", canon: "canon", folio: "fol." };
  return `${abbrev[type] ?? type} ${value}`;
}

function containerFor(item: CslItem) {
  return clean(item["container-title"]) || clean(item["collection-title"]);
}

/**
 * Chicago/Turabian-family footnote. Both styles share the same note shape;
 * Turabian differs from Chicago mainly in the bibliography form, which this
 * app does not yet render, so the note-level output is intentionally shared.
 */
function chicagoLikeNote(item: CslItem, locator: Locator | undefined) {
  const author = nameToLiteral(firstName(item, "author")) || "Unknown author";
  const title = itemTitle(item);
  const container = containerFor(item);
  const editor = nameToLiteral(firstName(item, "editor"));
  const translator = nameToLiteral(firstName(item, "translator"));
  const year = itemYear(item);
  const place = clean(item["publisher-place"]);
  const publisher = clean(item.publisher);
  const volume = clean(item.volume);
  const edition = clean(item.edition);
  const loc = locatorPhrase(locator, "note");

  const titlePart = item.type === "chapter" && container ? `"${title}," in ${container}` : `<i>${title}</i>`;
  const editorial = [editor && `ed. ${editor}`, translator && `trans. ${translator}`].filter(Boolean).join(", ");
  const editionPart = edition ? `${edition} ed.` : "";
  const imprintInner = [place, publisher].filter(Boolean).join(": ");
  const imprint = [imprintInner, year].filter(Boolean).join(", ");
  const volumePart = volume ? `vol. ${volume}` : "";

  const middle = [editorial, editionPart, volumePart].filter(Boolean).join(", ");
  const head = [`${author}, ${titlePart}`, middle].filter(Boolean).join(", ");
  const withImprint = imprint ? `${head} (${imprint})` : head;
  const parts = [withImprint, loc].filter(Boolean);

  return `${parts.join(", ")}.`;
}

/** SBL Handbook of Style note — closely follows Chicago with abbreviated locator conventions common in biblical/patristic citation (canon, folio, section). */
function sblNote(item: CslItem, locator: Locator | undefined) {
  return chicagoLikeNote(item, locator);
}

function apaStyle(item: CslItem, locator: Locator | undefined) {
  const author = nameToInverted(firstName(item, "author")) || "Unknown author";
  const year = itemYear(item) || "n.d.";
  const title = itemTitle(item);
  const container = containerFor(item);
  const publisher = clean(item.publisher);
  const loc = locatorPhrase(locator, "parenthetical");

  const titlePart = item.type === "chapter" && container ? `${title}. In ${container}` : `<i>${title}</i>`;
  const tail = [publisher, loc].filter(Boolean).join(", ");
  return `${author} (${year}). ${titlePart}${tail ? `. ${tail}` : ""}.`;
}

function mlaStyle(item: CslItem, locator: Locator | undefined) {
  const author = nameToInverted(firstName(item, "author")) || "Unknown author";
  const title = itemTitle(item);
  const container = containerFor(item);
  const publisher = clean(item.publisher);
  const year = itemYear(item);
  const loc = locatorPhrase(locator, "parenthetical");

  const titlePart = item.type === "chapter" && container ? `"${title}." <i>${container}</i>` : `<i>${title}</i>`;
  const tail = [publisher, year, loc].filter(Boolean).join(", ");
  return `${author}. ${titlePart}${tail ? `, ${tail}` : ""}.`;
}

function harvardStyle(item: CslItem, locator: Locator | undefined) {
  const author = nameToInverted(firstName(item, "author")) || "Unknown author";
  const year = itemYear(item) || "n.d.";
  const title = itemTitle(item);
  const place = clean(item["publisher-place"]);
  const publisher = clean(item.publisher);
  const loc = locatorPhrase(locator, "parenthetical");

  const imprint = [place, publisher].filter(Boolean).join(": ");
  const tail = [imprint, loc].filter(Boolean).join(", ");
  return `${author} ${year}, <i>${title}</i>${tail ? `, ${tail}` : ""}.`;
}

const FORMATTERS: Record<CitationStyleId, (item: CslItem, locator: Locator | undefined) => string> = {
  "chicago-note": chicagoLikeNote,
  "sbl-note": sblNote,
  "turabian-note": chicagoLikeNote,
  apa: apaStyle,
  mla: mlaStyle,
  harvard: harvardStyle
};

export function isCitationStyleId(value: unknown): value is CitationStyleId {
  return typeof value === "string" && (CITATION_STYLE_IDS as string[]).includes(value);
}

export function formatCitation(item: CslItem, styleId: CitationStyleId, locator?: Locator): string {
  const formatter = FORMATTERS[styleId];
  if (!formatter) throw new Error(`Unsupported citation style: ${styleId}`);
  return formatter(item, locator);
}
