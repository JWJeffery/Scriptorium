import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-ris";

// Reads a bibliography file or pasted text (BibTeX/BibLaTeX, RIS, CSL JSON: the
// formats Zotero, Endnote, Mendeley and library catalogues export) into CSL JSON
// entries, using the open-source Citation.js parsers.

export const MAX_IMPORT_CHARS = 2_000_000;
const MAX_ENTRIES = 500;

export type ImportedEntry = Record<string, unknown>;

export function parseBibliographyText(input: string): ImportedEntry[] {
  const text = input.replace(/^﻿/, "").trim();
  if (!text) throw new Error("Nothing to import: the text is empty.");
  if (text.length > MAX_IMPORT_CHARS) throw new Error("That file is too large to import.");
  let data: unknown;
  try {
    data = new Cite(text).data;
  } catch {
    throw new Error("That does not look like BibTeX, RIS or CSL JSON. Export from Zotero as “BibTeX”, “RIS” or “CSL JSON” and try again.");
  }
  if (!Array.isArray(data) || data.length === 0) throw new Error("No entries were found in that text.");
  return data.slice(0, MAX_ENTRIES).map((entry) => {
    const cleaned: ImportedEntry = { ...(entry as ImportedEntry) };
    // Parser bookkeeping, not bibliographic data.
    delete cleaned._graph;
    delete cleaned.id;
    delete cleaned["citation-key"];
    return cleaned;
  });
}
