import type { Prisma } from "@prisma/client";

export type CitationExchangeFormat = "csl-json" | "bibtex" | "biblatex" | "ris";

type CslName = { literal?: string; family?: string; given?: string };

export type CslBookRecord = {
  type?: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  translator?: CslName[];
  "container-title"?: string;
  publisher?: string;
  "publisher-place"?: string;
  volume?: string;
  edition?: string;
  issued?: { "date-parts"?: Array<Array<string | number>> };
};

const BIB_ENTRY_TYPE: Record<string, string> = {
  book: "book",
  chapter: "incollection",
  "article-journal": "article",
  manuscript: "unpublished"
};

const RIS_TYPE: Record<string, string> = {
  book: "BOOK",
  chapter: "CHAP",
  "article-journal": "JOUR",
  manuscript: "UNPD"
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function firstAuthorLiteral(record: CslBookRecord) {
  const first = record.author?.[0];
  if (!first) return "";
  if (first.literal) return first.literal;
  return [first.given, first.family].filter(Boolean).join(" ").trim();
}

function firstYear(record: CslBookRecord) {
  const value = record.issued?.["date-parts"]?.[0]?.[0];
  return value === undefined || value === null ? "" : String(value);
}

function bibEscape(value: string) {
  return value.replace(/[{}]/g, "").trim();
}

function citeKey(record: CslBookRecord) {
  const author = firstAuthorLiteral(record).split(/\s+/).at(-1) || "source";
  const year = firstYear(record) || "n.d";
  const titleWord = clean(record.title).split(/\s+/)[0] || "title";
  return [author, year, titleWord].join("-").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

function firstLiteral(names: CslName[] | undefined) {
  const first = names?.[0];
  if (!first) return "";
  if (first.literal) return first.literal;
  return [first.given, first.family].filter(Boolean).join(" ").trim();
}

const SUPPORTED_TYPES = new Set(["book", "chapter", "article-journal", "manuscript"]);

export function normalizeCslBookRecord(value: unknown): CslBookRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("CSL record must be an object.");
  }

  const input = value as CslBookRecord;
  const title = clean(input.title);
  const publisher = clean(input.publisher);
  const place = clean(input["publisher-place"]);
  const year = firstYear(input);
  const author = firstAuthorLiteral(input);
  const editor = firstLiteral(input.editor);
  const translator = firstLiteral(input.translator);
  const containerTitle = clean(input["container-title"]);
  const volume = clean(input.volume);
  const edition = clean(input.edition);
  const type = clean(input.type) || "book";

  if (!title) {
    throw new Error("CSL record requires title.");
  }

  if (year && !/^\d{1,4}$/.test(year)) {
    throw new Error("CSL issued year must be a 1-4 digit year.");
  }

  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(`Unsupported CSL item type: ${type}`);
  }

  if (type === "chapter" && !containerTitle) {
    throw new Error("CSL chapter records require container-title.");
  }

  const normalized: CslBookRecord = {
    type,
    title,
    author: author ? [{ literal: author }] : undefined,
    editor: editor ? [{ literal: editor }] : undefined,
    translator: translator ? [{ literal: translator }] : undefined,
    "container-title": containerTitle || undefined,
    publisher: publisher || undefined,
    "publisher-place": place || undefined,
    volume: volume || undefined,
    edition: edition || undefined,
    issued: year ? { "date-parts": [[Number(year)]] } : undefined
  };

  return JSON.parse(JSON.stringify(normalized)) as CslBookRecord;
}

export function cslToInputJson(record: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(normalizeCslBookRecord(record))) as Prisma.InputJsonObject;
}

export function exportCslJson(record: unknown) {
  return `${JSON.stringify(normalizeCslBookRecord(record), null, 2)}\n`;
}

export function exportBib(record: unknown, format: Extract<CitationExchangeFormat, "bibtex" | "biblatex">) {
  const normalized = normalizeCslBookRecord(record);
  const fields: Array<[string, string]> = [];
  const author = firstAuthorLiteral(normalized);
  const editor = firstLiteral(normalized.editor);
  const year = firstYear(normalized);
  const entryType = BIB_ENTRY_TYPE[normalized.type ?? "book"] ?? "misc";

  if (author) fields.push(["author", author]);
  else if (editor) fields.push(["editor", editor]);
  fields.push(["title", normalized.title ?? ""]);
  if (normalized["container-title"]) fields.push([normalized.type === "article-journal" ? "journal" : "booktitle", normalized["container-title"]]);
  if (normalized.volume) fields.push(["volume", normalized.volume]);
  if (normalized.edition) fields.push(["edition", normalized.edition]);
  if (normalized.publisher) fields.push(["publisher", normalized.publisher]);
  if (normalized["publisher-place"]) fields.push([format === "biblatex" ? "location" : "address", normalized["publisher-place"]]);
  if (year) fields.push(["year", year]);

  const body = fields.map(([key, value]) => `  ${key} = {${bibEscape(value)}}`).join(",\n");
  return `@${entryType}{${citeKey(normalized)},\n${body}\n}\n`;
}

const RIS_TAG_ORDER: Array<[string, string]> = [
  ["author", "AU"],
  ["editor", "ED"],
  ["title", "TI"],
  ["container-title", "T2"],
  ["publisher", "PB"],
  ["publisher-place", "CY"],
  ["volume", "VL"],
  ["edition", "ET"],
  ["year", "PY"]
];

export function exportRis(record: unknown) {
  const normalized = normalizeCslBookRecord(record);
  const risType = RIS_TYPE[normalized.type ?? "book"] ?? "GEN";
  const lines = [`TY  - ${risType}`];
  const author = firstAuthorLiteral(normalized);
  const editor = firstLiteral(normalized.editor);
  const year = firstYear(normalized);
  const values: Record<string, string | undefined> = {
    author,
    editor,
    title: normalized.title,
    "container-title": normalized["container-title"],
    publisher: normalized.publisher,
    "publisher-place": normalized["publisher-place"],
    volume: normalized.volume,
    edition: normalized.edition,
    year
  };

  for (const [key, tag] of RIS_TAG_ORDER) {
    const value = values[key];
    if (value) lines.push(`${tag}  - ${value}`);
  }

  lines.push("ER  - ");
  return `${lines.join("\n")}\n`;
}

function parseRisFields(content: string) {
  const fields = new Map<string, string>();
  const linePattern = /^([A-Z0-9]{2})\s*-\s*(.*)$/gm;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(content)) !== null) {
    const [, tag, value] = match;
    if (tag === "ER" || !value.trim()) continue;
    if (!fields.has(tag)) fields.set(tag, clean(value));
  }

  if (fields.size === 0) {
    throw new Error("RIS content has no supported fields.");
  }

  return fields;
}

export function importRis(content: string): CslBookRecord {
  const fields = parseRisFields(content);
  const typeTag = content.match(/^TY\s*-\s*(\S+)/m)?.[1];
  const reverseType = Object.entries(RIS_TYPE).find(([, ris]) => ris === typeTag)?.[0];

  return normalizeCslBookRecord({
    type: reverseType ?? "book",
    title: fields.get("TI"),
    author: fields.get("AU") ? [{ literal: fields.get("AU") }] : undefined,
    editor: fields.get("ED") ? [{ literal: fields.get("ED") }] : undefined,
    "container-title": fields.get("T2"),
    publisher: fields.get("PB"),
    "publisher-place": fields.get("CY"),
    volume: fields.get("VL"),
    edition: fields.get("ET"),
    issued: fields.get("PY") ? { "date-parts": [[fields.get("PY") as string]] } : undefined
  });
}

function parseBibFields(content: string) {
  const match = content.match(/@\w+\s*\{[^,]+,([\s\S]*)\}\s*$/m);
  if (!match) {
    throw new Error("BibTeX/BibLaTeX content must contain one entry.");
  }

  const fields = new Map<string, string>();
  const body = match[1];
  const fieldPattern = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:\{([^{}]*)\}|"([^"]*)")\s*,?/g;
  let fieldMatch: RegExpExecArray | null;

  while ((fieldMatch = fieldPattern.exec(body)) !== null) {
    fields.set(fieldMatch[1].toLowerCase(), clean(fieldMatch[2] ?? fieldMatch[3] ?? ""));
  }

  if (fields.size === 0) {
    throw new Error("BibTeX/BibLaTeX entry has no supported fields.");
  }

  return fields;
}

export function importBib(content: string): CslBookRecord {
  const fields = parseBibFields(content);
  const title = clean(fields.get("title"));
  const author = clean(fields.get("author"));
  const publisher = clean(fields.get("publisher"));
  const place = clean(fields.get("location") || fields.get("address") || fields.get("place"));
  const year = clean(fields.get("year") || fields.get("date"));

  return normalizeCslBookRecord({
    type: "book",
    title,
    author: author ? [{ literal: author }] : undefined,
    publisher: publisher || undefined,
    "publisher-place": place || undefined,
    issued: year ? { "date-parts": [[year]] } : undefined
  });
}

export function importCslJson(content: string): CslBookRecord {
  const parsed = JSON.parse(content) as unknown;
  return normalizeCslBookRecord(parsed);
}

export function importCitationRecord(format: CitationExchangeFormat, content: string) {
  if (format === "csl-json") return importCslJson(content);
  if (format === "ris") return importRis(content);
  return importBib(content);
}

export function exportCitationRecord(format: CitationExchangeFormat, record: unknown) {
  if (format === "csl-json") return exportCslJson(record);
  if (format === "ris") return exportRis(record);
  return exportBib(record, format);
}
