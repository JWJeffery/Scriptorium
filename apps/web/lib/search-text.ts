// Pure helpers for the search endpoint: turning a typed query into terms,
// finding where they occur in a page of text, and cutting a readable snippet.
// No database or framework imports so the behaviour can be tested directly.

export type Snippet = { before: string; match: string; after: string };

const MAX_TERMS = 6;

// "grace of God"  -> three terms, all of which must appear on the page.
// "\"grace of God\"" -> one phrase term.
export function parseQuery(raw: string): string[] {
  const terms: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null && terms.length < MAX_TERMS) {
    const term = (match[1] ?? match[2] ?? "").replace(/\s+/g, " ").trim();
    if (term.length > 0) terms.push(term);
  }
  return terms;
}

function squash(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

// OCR'd and extracted pages break lines mid-phrase and hyphenate across lines
// ("integ-\nrity"), so matching is done against whitespace-squashed text.
export function normalizeForSearch(text: string) {
  return squash(text.replace(/-\s*\n\s*/g, ""));
}

export function findFirst(text: string, terms: string[]): { index: number; length: number } | null {
  const haystack = normalizeForSearch(text).toLowerCase();
  const whole = terms.join(" ").toLowerCase();
  const phraseIndex = haystack.indexOf(whole);
  if (terms.length > 1 && phraseIndex >= 0) return { index: phraseIndex, length: whole.length };
  let best: { index: number; length: number } | null = null;
  for (const term of terms) {
    const index = haystack.indexOf(term.toLowerCase());
    if (index >= 0 && (best === null || index < best.index)) best = { index, length: term.length };
  }
  return best;
}

// 2 = the terms appear together as a phrase, 1 = all terms present, 0 = no match.
export function matchRank(text: string, terms: string[]): 0 | 1 | 2 {
  const haystack = normalizeForSearch(text).toLowerCase();
  if (terms.length === 0) return 0;
  if (!terms.every((term) => haystack.includes(term.toLowerCase()))) return 0;
  return terms.length > 1 && haystack.includes(terms.join(" ").toLowerCase()) ? 2 : 1;
}

export function makeSnippet(text: string, terms: string[], radius = 110): Snippet {
  const flat = normalizeForSearch(text);
  const hit = findFirst(text, terms);
  if (!hit) return { before: flat.slice(0, radius * 2), match: "", after: "" };
  const start = Math.max(hit.index - radius, 0);
  const end = Math.min(hit.index + hit.length + radius, flat.length);
  return {
    before: (start > 0 ? "…" : "") + flat.slice(start, hit.index),
    match: flat.slice(hit.index, hit.index + hit.length),
    after: flat.slice(hit.index + hit.length, end) + (end < flat.length ? "…" : "")
  };
}

// Line number (1-based) of the first match, for plain-text documents that are
// stored as one block rather than page by page.
export function lineOfFirstMatch(text: string, terms: string[]): number | null {
  const lower = text.toLowerCase();
  let best = -1;
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase());
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  if (best < 0) return null;
  return text.slice(0, best).split("\n").length;
}

// Escape LIKE wildcards so a typed "50%" or "a_b" is searched literally.
export function escapeLike(term: string) {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const COMMON_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "is", "it", "of", "on", "or", "the", "to", "with"]);

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// Which words on a page to light up for a search. Prefers the whole query as
// a contiguous run of words; otherwise lights each occurrence of the query's
// meaningful words (ignoring "the", "of", ... when other words are present).
export function matchWordIndexes(wordTexts: string[], terms: string[]): number[] {
  const tokens = terms.flatMap((term) => term.split(/\s+/)).map(normalizeWord).filter(Boolean);
  if (tokens.length === 0) return [];
  const words = wordTexts.map(normalizeWord);

  const runs: number[] = [];
  for (let start = 0; start + tokens.length <= words.length; start += 1) {
    if (tokens.every((token, offset) => words[start + offset] === token)) {
      for (let offset = 0; offset < tokens.length; offset += 1) runs.push(start + offset);
    }
  }
  if (runs.length > 0) return runs;

  const meaningful = tokens.filter((token) => !COMMON_WORDS.has(token));
  const wanted = new Set(meaningful.length > 0 ? meaningful : tokens);
  return words.flatMap((word, index) => (wanted.has(word) ? [index] : []));
}
