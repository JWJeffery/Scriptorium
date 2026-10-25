import { parseAuthors } from "./author-names.ts";

// Look up a book by ISBN (Open Library, then Google Books) or a work by DOI
// (doi.org, which answers with CSL JSON from Crossref or DataCite). Only these
// fixed services are ever contacted; the text a person types is validated and
// never used as a web address.

export type LookupResult = { csl: Record<string, unknown>; provider: string };
type Fetch = typeof fetch;

const TIMEOUT_MS = 8000;

/** Returns the 13-digit ISBN, or null if the text is not a valid ISBN-10/13. */
export function normalizeIsbn(input: string): string | null {
  const digits = input.toUpperCase().replace(/[\s-]/g, "").replace(/^ISBN(?:-?1[03])?:?/, "");
  if (/^\d{13}$/.test(digits)) {
    const sum = digits.split("").reduce((total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3), 0);
    return sum % 10 === 0 ? digits : null;
  }
  if (/^\d{9}[\dX]$/.test(digits)) {
    const sum = digits.split("").reduce((total, char, index) => total + (char === "X" ? 10 : Number(char)) * (10 - index), 0);
    if (sum % 11 !== 0) return null;
    const core = `978${digits.slice(0, 9)}`;
    const check = (10 - (core.split("").reduce((total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3), 0) % 10)) % 10;
    return `${core}${check}`;
  }
  return null;
}

/** Returns the bare DOI ("10.xxxx/yyyy"), or null. */
export function normalizeDoi(input: string): string | null {
  const text = input.trim().replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  return /^10\.\d{4,9}\/[^\s]+$/.test(text) ? text : null;
}

async function getJson(fetchImpl: Fetch, url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { headers: { "user-agent": "Scriptorium/1.0 (personal research tool)", ...headers }, signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function yearOf(text: unknown) {
  const match = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(typeof text === "string" ? text : "");
  return match ? Number(match[1]) : undefined;
}

function clean<T extends Record<string, unknown>>(record: T): T {
  for (const key of Object.keys(record)) if (record[key] === undefined || record[key] === "" || (Array.isArray(record[key]) && (record[key] as unknown[]).length === 0)) delete record[key];
  return record;
}

type OpenLibraryBook = { title?: string; subtitle?: string; authors?: Array<{ name?: string }>; publishers?: Array<{ name?: string }>; publish_places?: Array<{ name?: string }>; publish_date?: string; number_of_pages?: number };

export function openLibraryToCsl(book: OpenLibraryBook, isbn: string): Record<string, unknown> {
  const authors = (book.authors ?? []).map((author) => author.name ?? "").filter(Boolean).flatMap((name) => parseAuthors(name));
  return clean({
    type: "book",
    title: [book.title, book.subtitle].filter(Boolean).join(": "),
    author: authors,
    publisher: book.publishers?.[0]?.name,
    "publisher-place": book.publish_places?.[0]?.name,
    issued: yearOf(book.publish_date) ? { "date-parts": [[yearOf(book.publish_date)]] } : undefined,
    "number-of-pages": book.number_of_pages ? String(book.number_of_pages) : undefined,
    ISBN: isbn
  });
}

type GoogleVolume = { volumeInfo?: { title?: string; subtitle?: string; authors?: string[]; publisher?: string; publishedDate?: string; pageCount?: number } };

export function googleBooksToCsl(volume: GoogleVolume, isbn: string): Record<string, unknown> {
  const info = volume.volumeInfo ?? {};
  return clean({
    type: "book",
    title: [info.title, info.subtitle].filter(Boolean).join(": "),
    author: (info.authors ?? []).flatMap((name) => parseAuthors(name)),
    publisher: info.publisher,
    issued: yearOf(info.publishedDate) ? { "date-parts": [[yearOf(info.publishedDate)]] } : undefined,
    "number-of-pages": info.pageCount ? String(info.pageCount) : undefined,
    ISBN: isbn
  });
}

export async function lookupIsbn(isbn13: string, fetchImpl: Fetch = fetch): Promise<LookupResult | null> {
  const open = (await getJson(fetchImpl, `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`)) as Record<string, OpenLibraryBook> | null;
  const book = open?.[`ISBN:${isbn13}`];
  if (book?.title) return { csl: openLibraryToCsl(book, isbn13), provider: "Open Library" };

  const google = (await getJson(fetchImpl, `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}&maxResults=1`)) as { items?: GoogleVolume[] } | null;
  const volume = google?.items?.[0];
  if (volume?.volumeInfo?.title) return { csl: googleBooksToCsl(volume, isbn13), provider: "Google Books" };
  return null;
}

const TYPE_MAP: Record<string, string> = {
  "journal-article": "article-journal",
  "book-chapter": "chapter",
  "proceedings-article": "paper-conference",
  "posted-content": "article",
  "reference-entry": "entry-encyclopedia",
  monograph: "book",
  "edited-book": "book",
  "book-section": "chapter",
  dissertation: "thesis"
};

const DROPPED_FROM_DOI = ["indexed", "reference-count", "references-count", "reference", "license", "link", "deposited", "published-print", "published-online", "published", "created", "member", "prefix", "is-referenced-by-count", "content-domain", "relation", "score", "update-policy", "abstract", "source", "resource", "journal-issue", "alternative-id", "assertion", "archive", "update-to", "funder", "short-container-title"];

export async function lookupDoi(doi: string, fetchImpl: Fetch = fetch): Promise<LookupResult | null> {
  const record = (await getJson(fetchImpl, `https://doi.org/${encodeURI(doi)}`, { accept: "application/vnd.citationstyles.csl+json" })) as Record<string, unknown> | null;
  if (!record || typeof record.title !== "string" && !Array.isArray(record.title)) return null;
  const csl: Record<string, unknown> = { ...record };
  for (const key of DROPPED_FROM_DOI) delete csl[key];
  delete csl.id;
  if (Array.isArray(csl.title)) csl.title = String(csl.title[0] ?? "");
  // Crossref's own type names -> the names citation styles understand.
  const type = typeof csl.type === "string" ? csl.type : "";
  csl.type = TYPE_MAP[type] ?? type;
  for (const role of ["author", "editor", "translator"]) {
    if (Array.isArray(csl[role])) {
      csl[role] = (csl[role] as Array<Record<string, unknown>>).map((name) => clean({ family: name.family, given: name.given, literal: name.literal, suffix: name.suffix }));
    }
  }
  csl.DOI = csl.DOI ?? doi;
  return { csl: clean(csl), provider: "Crossref / DataCite" };
}
