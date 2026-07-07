import type { Prisma } from "@prisma/client";
import { normalizeCslBookRecord, type CslBookRecord } from "./citation-exchange";

export type ZoteroCreator = {
  creatorType?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
};

export type ZoteroBookItem = {
  itemType?: string;
  title?: string;
  creators?: ZoteroCreator[];
  place?: string;
  publisher?: string;
  date?: string;
  extra?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function yearFromDate(value: string) {
  const match = value.match(/\b(\d{1,4})\b/);
  return match?.[1] ?? "";
}

function firstCreatorLiteral(creators: ZoteroCreator[] | undefined) {
  const creator = creators?.[0];
  if (!creator) return "";
  if (creator.name) return clean(creator.name);
  return [clean(creator.firstName), clean(creator.lastName)].filter(Boolean).join(" ");
}

function splitCreatorName(name: string): ZoteroCreator | undefined {
  const value = clean(name);
  if (!value) return undefined;
  const parts = value.split(/\s+/);
  if (parts.length === 1) {
    return { creatorType: "author", name: value };
  }
  return { creatorType: "author", firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

function cslAuthorLiteral(record: CslBookRecord) {
  const first = record.author?.[0];
  if (!first) return "";
  if (first.literal) return first.literal;
  return [first.given, first.family].filter(Boolean).join(" ").trim();
}

function cslYear(record: CslBookRecord) {
  const value = record.issued?.["date-parts"]?.[0]?.[0];
  return value === undefined || value === null ? "" : String(value);
}

export function cslToZoteroBookItem(record: unknown): ZoteroBookItem {
  const normalized = normalizeCslBookRecord(record);
  const creator = splitCreatorName(cslAuthorLiteral(normalized));
  const item: ZoteroBookItem = {
    itemType: "book",
    title: normalized.title,
    creators: creator ? [creator] : undefined,
    place: normalized["publisher-place"] || undefined,
    publisher: normalized.publisher || undefined,
    date: cslYear(normalized) || undefined,
    extra: "Scriptorium: zotero-compatible-source-v1"
  };

  return JSON.parse(JSON.stringify(item)) as ZoteroBookItem;
}

export function zoteroBookItemToCsl(item: unknown): CslBookRecord {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error("Zotero item must be an object.");
  }

  const zotero = item as ZoteroBookItem;
  const title = clean(zotero.title);
  const year = yearFromDate(clean(zotero.date));
  const author = firstCreatorLiteral(zotero.creators);

  if (clean(zotero.itemType) && clean(zotero.itemType) !== "book") {
    throw new Error("Only Zotero book items are supported for this gate.");
  }

  if (!title) {
    throw new Error("Zotero item requires title.");
  }

  return normalizeCslBookRecord({
    type: "book",
    title,
    author: author ? [{ literal: author }] : undefined,
    publisher: clean(zotero.publisher) || undefined,
    "publisher-place": clean(zotero.place) || undefined,
    issued: year ? { "date-parts": [[year]] } : undefined
  });
}

export function exportZoteroItemJson(record: unknown) {
  return `${JSON.stringify(cslToZoteroBookItem(record), null, 2)}\n`;
}

export function importZoteroItemJson(content: string) {
  return zoteroBookItemToCsl(JSON.parse(content) as unknown);
}

export function zoteroCslToInputJson(item: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(zoteroBookItemToCsl(item))) as Prisma.InputJsonObject;
}
