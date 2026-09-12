import type { PdfAuthoritativeWord } from "../components/PdfAnchoredPageReader";

export type ParsedReadingNote = {
  id: string;
  pageLabel: string;
  pageNumber?: number;
  quote: string;
  note: string;
  sourceParagraph: string;
};

export type ReadingNotesPage = {
  pageIndex: number;
  text: string;
  words: PdfAuthoritativeWord[];
};

export type ReadingNoteCandidate = ParsedReadingNote & {
  kind: "highlight" | "page-note";
  pdfPageIndex?: number;
  selectedText: string;
  confidence: number;
  matchStatus: "high" | "review" | "unmatched" | "page-note";
  anchor?: {
    selectedText: string;
    pageNumber: number;
    beforeContext: string;
    afterContext: string;
    rects: Array<{ left: number; top: number; width: number; height: number }>;
  };
};

const LOCATOR = /\(\s*((?:\d+|[ivxlcdm]+)(?:\s*[-–—,]\s*(?:\d+|[ivxlcdm]+))*)\s*\)/gi;
const HEADING = /^[“"'‘’]?(?:preface|introduction\b|chapter\s+\d+\b|patterns? in theology\b|appendix\b|index\b)/i;

function cleanInline(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function firstArabicPage(label: string) {
  const match = label.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function quoteSpans(value: string) {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  for (const match of value.matchAll(/“([^”]{12,})”/g)) {
    if (match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length, text: cleanInline(match[1]) });
  }
  // Old notes often use straight quotation marks, including the occasional
  // doubled opening mark (an introductory fragment followed by the actual
  // quotation). Adjacent-mark spans retain the inner long quotation in that
  // case; a conventional non-overlapping regex loses it.
  const straightMarks = Array.from(value.matchAll(/"/g)).flatMap((match) => match.index === undefined ? [] : [match.index]);
  for (let index = 0; index < straightMarks.length - 1; index++) {
    const start = straightMarks[index];
    const end = straightMarks[index + 1];
    const text = cleanInline(value.slice(start + 1, end));
    if (text.length >= 12) spans.push({ start, end: end + 1, text });
  }
  return spans.sort((a, b) => b.text.length - a.text.length);
}

function looksLikeBibliography(value: string, index: number) {
  if (index !== 0) return false;
  return /\.\s*(?:London|New York|Oxford|Cambridge)\s*:\s*[^,]+,\s*\d{4}\.?$/i.test(value);
}

export function parseReadingNotes(text: string): ParsedReadingNote[] {
  const paragraphs = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map(cleanInline)
    .filter(Boolean);

  const parsed: ParsedReadingNote[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (HEADING.test(paragraph) || looksLikeBibliography(paragraph, index)) return;
    const locators = Array.from(paragraph.matchAll(LOCATOR));
    const locator = locators.at(-1);
    if (!locator || locator.index === undefined) {
      // Josh's long-running note-taking pattern sometimes puts his own
      // response in the paragraph immediately after the quoted/cited one,
      // without repeating the page number. Preserve that prose with the
      // preceding record instead of silently dropping it.
      const previous = parsed.at(-1);
      if (previous) previous.note = cleanInline(`${previous.note} ${paragraph}`);
      return;
    }
    const pageLabel = locator[1].replace(/\s+/g, "");
    const trailing = paragraph.slice(locator.index + locator[0].length).replace(/^\s*[.;,:—–-]+\s*/, "");
    const body = cleanInline(`${paragraph.slice(0, locator.index)} ${trailing}`);
    if (!body) return;

    const quote = quoteSpans(body)[0];
    if (quote) {
      const before = cleanInline(body.slice(0, quote.start).replace(/^[\s:;,—–-]+|[\s:;,—–-]+$/g, ""));
      const after = cleanInline(body.slice(quote.end).replace(/^[\s:;,—–-]+|[\s:;,—–-]+$/g, ""));
      parsed.push({
        id: `reading-note-${parsed.length + 1}`,
        pageLabel,
        pageNumber: firstArabicPage(pageLabel),
        quote: quote.text,
        note: [before, after].filter(Boolean).join(" "),
        sourceParagraph: paragraph
      });
      return;
    }

    parsed.push({
      id: `reading-note-${parsed.length + 1}`,
      pageLabel,
      pageNumber: firstArabicPage(pageLabel),
      quote: "",
      note: body,
      sourceParagraph: paragraph
    });
  });
  return parsed;
}

function normalizedToken(value: string) {
  return value.toLocaleLowerCase("en").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

function tokens(value: string) {
  return value.split(/\s+/).map(normalizedToken).filter(Boolean);
}

function editDistance(a: string, b: string) {
  if (a === b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

function tokenSubstitutionCost(a: string, b: string) {
  if (a === b) return 0;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return 0.3;
  if (Math.max(a.length, b.length) >= 4 && editDistance(a, b) === 1) return 0.35;
  return 1;
}

function tokenSequenceDistance(a: string[], b: string[]) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + tokenSubstitutionCost(a[i - 1], b[j - 1]));
      diagonal = above;
    }
  }
  return previous[b.length];
}

function sortedWords(words: PdfAuthoritativeWord[]) {
  return [...words].sort((a, b) => {
    if (typeof a.blockNum === "number" && typeof b.blockNum === "number" && a.blockNum !== b.blockNum) return a.blockNum - b.blockNum;
    if (typeof a.lineNum === "number" && typeof b.lineNum === "number" && a.lineNum !== b.lineNum) return a.lineNum - b.lineNum;
    const sameLine = Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < Math.min(a.height, b.height) * 0.6;
    return sameLine ? a.left - b.left : a.top - b.top;
  });
}

function contextFor(words: PdfAuthoritativeWord[], start: number, end: number) {
  return {
    beforeContext: words.slice(Math.max(0, start - 24), start).map((word) => word.text).join(" "),
    afterContext: words.slice(end, Math.min(words.length, end + 24)).map((word) => word.text).join(" ")
  };
}

type Match = { page: ReadingNotesPage; start: number; end: number; score: number; words: PdfAuthoritativeWord[] };

function bestMatch(quote: string, pages: ReadingNotesPage[], expectedPage?: number): Match | undefined {
  const quoteTokens = tokens(quote);
  if (quoteTokens.length < 3) return undefined;
  let best: Match | undefined;

  for (const page of pages) {
    const words = sortedWords(page.words);
    const pageTokens = words.map((word) => normalizedToken(word.text));
    if (pageTokens.length === 0) continue;

    const starts = new Set<number>();
    const probes = quoteTokens.slice(0, Math.min(10, quoteTokens.length));
    probes.forEach((probe, quoteIndex) => {
      pageTokens.forEach((token, pageIndex) => {
        if (token === probe) starts.add(Math.max(0, pageIndex - quoteIndex));
      });
    });
    if (starts.size === 0 && expectedPage === page.pageIndex) {
      for (let start = 0; start < pageTokens.length; start++) starts.add(start);
    }

    for (const start of starts) {
      for (let delta = -2; delta <= 2; delta++) {
        const length = quoteTokens.length + delta;
        if (length < 3 || start + length > pageTokens.length) continue;
        const candidateTokens = pageTokens.slice(start, start + length);
        const rawScore = 1 - tokenSequenceDistance(quoteTokens, candidateTokens) / Math.max(quoteTokens.length, candidateTokens.length);
        const proximityBonus = expectedPage === undefined ? 0 : Math.max(0, 0.03 - Math.abs(page.pageIndex - expectedPage) * 0.01);
        const score = Math.min(1, rawScore + proximityBonus);
        if (!best || score > best.score) best = { page, start, end: start + length, score, words };
      }
    }
  }
  return best;
}

export function analyzeReadingNotes(
  notes: ParsedReadingNote[],
  pages: ReadingNotesPage[],
  mapping: { basePdfPageIndex: number; baseBookPage: number }
): ReadingNoteCandidate[] {
  const configuredOffset = mapping.basePdfPageIndex - mapping.baseBookPage;
  const quoteMatches = new Map<string, Match | undefined>();
  for (const entry of notes) {
    if (!entry.quote) continue;
    const expectedPage = entry.pageNumber === undefined ? undefined : entry.pageNumber + configuredOffset;
    quoteMatches.set(entry.id, bestMatch(entry.quote, pages, expectedPage));
  }
  // A set of quotations with printed page locators is also evidence for the
  // page map. This matters for old notes made against a physical book when
  // the registered scan has covers or front matter before book page 1.
  const observedOffsets = notes.flatMap((entry) => {
    const match = quoteMatches.get(entry.id);
    return entry.pageNumber !== undefined && match && match.score >= 0.78 ? [match.page.pageIndex - entry.pageNumber] : [];
  }).sort((a, b) => a - b);
  const inferredOffset = observedOffsets.length >= 3 ? observedOffsets[Math.floor(observedOffsets.length / 2)] : configuredOffset;

  return notes.map((entry) => {
    const expectedPage = entry.pageNumber === undefined ? undefined : entry.pageNumber + inferredOffset;

    if (!entry.quote) {
      return {
        ...entry,
        kind: "page-note",
        pdfPageIndex: expectedPage,
        selectedText: "",
        confidence: 1,
        matchStatus: "page-note"
      };
    }

    const match = quoteMatches.get(entry.id);
    if (!match || match.score < 0.68) {
      return { ...entry, kind: "highlight", pdfPageIndex: expectedPage, selectedText: entry.quote, confidence: match?.score ?? 0, matchStatus: "unmatched" };
    }
    const matchedWords = match.words.slice(match.start, match.end);
    const selectedText = matchedWords.map((word) => word.text).join(" ");
    const context = contextFor(match.words, match.start, match.end);
    return {
      ...entry,
      kind: "highlight",
      pdfPageIndex: match.page.pageIndex,
      selectedText,
      confidence: match.score,
      matchStatus: match.score >= 0.86 ? "high" : "review",
      anchor: {
        selectedText,
        pageNumber: match.page.pageIndex,
        ...context,
        rects: matchedWords.map((word) => ({ left: word.left, top: word.top, width: word.width, height: word.height }))
      }
    };
  });
}
