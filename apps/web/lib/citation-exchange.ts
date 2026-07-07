import type { Prisma } from "@prisma/client";

export type CitationExchangeFormat = "csl-json" | "bibtex" | "biblatex";

export type CslBookRecord = {
  type?: string;
  title?: string;
  author?: Array<{ literal?: string; family?: string; given?: string }>;
  publisher?: string;
  "publisher-place"?: string;
  issued?: { "date-parts"?: Array<Array<string | number>> };
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

  if (!title) {
    throw new Error("CSL record requires title.");
  }

  if (year && !/^\d{1,4}$/.test(year)) {
    throw new Error("CSL issued year must be a 1-4 digit year.");
  }

  const normalized: CslBookRecord = {
    type: clean(input.type) || "book",
    title,
    author: author ? [{ literal: author }] : undefined,
    publisher: publisher || undefined,
    "publisher-place": place || undefined,
    issued: year ? { "date-parts": [[Number(year)]] } : undefined
  };

  return JSON.parse(JSON.stringify(normalized)) as CslBookRecord;
}

export function cslToInputJson(record: CslBookRecord): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(normalizeCslBookRecord(record))) as Prisma.InputJsonObject;
}

export function exportCslJson(record: CslBookRecord) {
  return `${JSON.stringify(normalizeCslBookRecord(record), null, 2)}\n`;
}

export function exportBib(record: CslBookRecord, format: Extract<CitationExchangeFormat, "bibtex" | "biblatex">) {
  const normalized = normalizeCslBookRecord(record);
  const fields: Array<[string, string]> = [];
  const author = firstAuthorLiteral(normalized);
  const year = firstYear(normalized);

  if (author) fields.push(["author", author]);
  fields.push(["title", normalized.title ?? ""]);
  if (normalized.publisher) fields.push(["publisher", normalized.publisher]);
  if (normalized["publisher-place"]) fields.push([format === "biblatex" ? "location" : "address", normalized["publisher-place"]]);
  if (year) fields.push(["year", year]);

  const body = fields.map(([key, value]) => `  ${key} = {${bibEscape(value)}}`).join(",\n");
  return `@book{${citeKey(normalized)},\n${body}\n}\n`;
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
  return importBib(content);
}

export function exportCitationRecord(format: CitationExchangeFormat, record: CslBookRecord) {
  if (format === "csl-json") return exportCslJson(record);
  return exportBib(record, format);
}
