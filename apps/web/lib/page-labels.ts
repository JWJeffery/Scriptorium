// Turns PDF page numbers into the printed page labels a scholar cites
// (iv, 217, A-3), and back again.
//
// A book is described by ranges. Each range says: from this PDF page, the
// printed number is N and rises by one per page, in this style.
//   { startPdfPage: 5,  endPdfPage: 11, system: "roman-lower", startValue: 1 }  -> i ... vii
//   { startPdfPage: 12, endPdfPage: null, system: "arabic",    startValue: 1 }  -> 1, 2, 3 ...
// Older documents only have one linear rule in a note ("PDF page X = book
// page Y"); legacyRange() turns that into a single range.

export type NumberingSystem = "arabic" | "roman-lower" | "roman-upper" | "unnumbered";

export type PageRangeSpec = {
  startPdfPage: number;
  endPdfPage: number | null;
  system: NumberingSystem;
  startValue: number;
  prefix: string;
};

export const NUMBERING_SYSTEMS: { value: NumberingSystem; label: string }[] = [
  { value: "arabic", label: "1, 2, 3" },
  { value: "roman-lower", label: "i, ii, iii" },
  { value: "roman-upper", label: "I, II, III" },
  { value: "unnumbered", label: "No printed number" }
];

const ROMAN: Array<[number, string]> = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];

export function toRoman(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) return "";
  let rest = value;
  let out = "";
  for (const [size, glyph] of ROMAN) {
    while (rest >= size) { out += glyph; rest -= size; }
  }
  return out;
}

export function fromRoman(text: string): number | null {
  const lower = text.trim().toLowerCase();
  if (!/^[ivxlcdm]+$/.test(lower)) return null;
  let total = 0;
  for (let i = 0; i < lower.length; i += 1) {
    const here = ROMAN.find(([, glyph]) => glyph === lower[i])?.[0] ?? 0;
    const next = ROMAN.find(([, glyph]) => glyph === lower[i + 1])?.[0] ?? 0;
    total += here < next ? -here : here;
  }
  // Reject non-canonical spellings such as "iiii" or "vx".
  return toRoman(total) === lower ? total : null;
}

function covers(range: PageRangeSpec, pdfPage: number) {
  return pdfPage >= range.startPdfPage && (range.endPdfPage === null || pdfPage <= range.endPdfPage);
}

// The ranges are expected sorted and non-overlapping (see validateRanges), but
// the latest-starting range that covers the page wins if they are not.
function rangeFor(ranges: PageRangeSpec[], pdfPage: number) {
  return [...ranges].filter((range) => covers(range, pdfPage)).sort((a, b) => b.startPdfPage - a.startPdfPage)[0];
}

/** The printed label of a PDF page, or null if the page has no printed number. */
export function labelForPage(ranges: PageRangeSpec[], pdfPage: number): string | null {
  const range = rangeFor(ranges, pdfPage);
  if (!range || range.system === "unnumbered") return null;
  const value = range.startValue + (pdfPage - range.startPdfPage);
  if (value < 1) return null;
  const body = range.system === "arabic" ? String(value) : range.system === "roman-lower" ? toRoman(value) : toRoman(value).toUpperCase();
  return body ? `${range.prefix}${body}` : null;
}

/** The PDF page that carries a printed label ("xiv", "217", "A-3"), or null. */
export function pdfPageForLabel(ranges: PageRangeSpec[], label: string, pdfPageCount?: number): number | null {
  const wanted = label.trim();
  if (!wanted) return null;
  for (const range of ranges) {
    if (range.system === "unnumbered") continue;
    if (range.prefix && !wanted.startsWith(range.prefix)) continue;
    const body = range.prefix ? wanted.slice(range.prefix.length) : wanted;
    let value: number | null = null;
    if (range.system === "arabic") value = /^\d+$/.test(body) ? Number(body) : null;
    else value = fromRoman(body);
    if (value === null) continue;
    if (range.system === "roman-upper" && body !== body.toUpperCase()) continue;
    if (range.system === "roman-lower" && body !== body.toLowerCase()) continue;
    const pdfPage = range.startPdfPage + (value - range.startValue);
    const end = range.endPdfPage ?? pdfPageCount ?? Number.MAX_SAFE_INTEGER;
    if (pdfPage >= range.startPdfPage && pdfPage <= end) return pdfPage;
  }
  return null;
}

/** Why a set of ranges is not acceptable, or null if it is fine. */
export function validateRanges(ranges: PageRangeSpec[]): string | null {
  const sorted = [...ranges].sort((a, b) => a.startPdfPage - b.startPdfPage);
  for (let i = 0; i < sorted.length; i += 1) {
    const range = sorted[i];
    if (!Number.isInteger(range.startPdfPage) || range.startPdfPage < 1) return "Each range must start at PDF page 1 or later.";
    if (range.endPdfPage !== null && (!Number.isInteger(range.endPdfPage) || range.endPdfPage < range.startPdfPage)) return "A range cannot end before it starts.";
    if (!NUMBERING_SYSTEMS.some((system) => system.value === range.system)) return "Unknown numbering style.";
    if (!Number.isInteger(range.startValue) || range.startValue < 1 || range.startValue > 3999) return "The starting number must be between 1 and 3999.";
    if (range.prefix.length > 16) return "A prefix can be at most 16 characters.";
    const next = sorted[i + 1];
    if (next) {
      const end = range.endPdfPage ?? Number.MAX_SAFE_INTEGER;
      if (next.startPdfPage <= end) return `PDF pages ${next.startPdfPage}${range.endPdfPage === null ? "+" : ""} are claimed by two ranges. A range with no end must be the last one.`;
    }
  }
  return null;
}

export function parseMappingRule(note: string | null | undefined): { basePdfPage: number; baseBookPage: number } {
  const match = /PDF page (\d+) = book page (\d+)/.exec(note ?? "");
  return match ? { basePdfPage: Number(match[1]), baseBookPage: Number(match[2]) } : { basePdfPage: 1, baseBookPage: 1 };
}

/** The single range equivalent to a document's old "PDF page X = book page Y" rule. */
export function legacyRange(note: string | null | undefined): PageRangeSpec {
  const rule = parseMappingRule(note);
  const startValue = rule.baseBookPage + (1 - rule.basePdfPage);
  // Pages before the printed page 1 have no number: start the range where it begins.
  const startPdfPage = startValue >= 1 ? 1 : 1 + (1 - startValue);
  return { startPdfPage, endPdfPage: null, system: "arabic", startValue: Math.max(startValue, 1), prefix: "" };
}

/** Label using ranges when present, otherwise the document's old linear rule. */
export function bookLabel(ranges: PageRangeSpec[] | null | undefined, note: string | null | undefined, pdfPage: number): string | null {
  return labelForPage(ranges && ranges.length > 0 ? ranges : [legacyRange(note)], pdfPage);
}

// Kept for callers that only have the old rule.
export function bookLabelFromRule(note: string | null | undefined, pdfPage: number): string {
  return labelForPage([legacyRange(note)], pdfPage) ?? "";
}
