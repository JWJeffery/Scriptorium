// Turns the author text people type ("Stephen W. Sykes", "Sykes, Stephen W.",
// "A. Smith and B. Jones", "{World Council of Churches}") into structured CSL
// names. Style files need family and given names separately: short forms such as
// "Sykes, Integrity, 12" cannot be produced from one block of text.

export type CslName = { family?: string; given?: string; suffix?: string; "non-dropping-particle"?: string; literal?: string };

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);
const PARTICLES = new Set(["de", "del", "della", "der", "den", "di", "du", "la", "le", "van", "von", "vom", "ten", "ter", "bin", "ibn", "al", "el", "st.", "st", "mac"]);
const ORGANISATION = /\b(council|society|university|press|conference|committee|association|church|churches|institute|commission|college|seminary|synod|fellowship|foundation|ministry|department|bureau|board|academy|library|archive|archives|diocese|province|communion|congregation|brotherhood|trust|league|union)\b/i;

function parseOne(raw: string): CslName | null {
  let text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const braced = /^\{(.+)\}$/.exec(text);
  if (braced) return { literal: braced[1].trim() };
  if (ORGANISATION.test(text) && !text.includes(",")) return { literal: text };

  let suffix: string | undefined;
  // "Last, First" and "Last, First, Jr."
  if (text.includes(",")) {
    const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      if (parts.length === 3 && SUFFIXES.has(parts[2].toLowerCase())) suffix = parts[2];
      const family = parts[0];
      const given = parts[1];
      return { family, given, ...(suffix ? { suffix } : {}) };
    }
    text = parts[0] ?? text;
  }

  const words = text.split(" ");
  if (words.length === 1) return { family: words[0] };
  const last = words[words.length - 1];
  if (SUFFIXES.has(last.toLowerCase()) && words.length > 2) { suffix = last; words.pop(); }
  let familyStart = words.length - 1;
  while (familyStart > 1 && PARTICLES.has(words[familyStart - 1].toLowerCase())) familyStart -= 1;
  const family = words.slice(familyStart).join(" ");
  const given = words.slice(0, familyStart).join(" ");
  return { family, given, ...(suffix ? { suffix } : {}) };
}

/** Several authors are separated by " and ", "&" or ";". */
export function parseAuthors(input: string): CslName[] {
  const text = input.trim();
  if (!text) return [];
  // Keep braced organisation names intact while splitting.
  const pieces: string[] = [];
  let depth = 0;
  let current = "";
  const splitters = /^(\s+and\s+|\s*&\s*|\s*;\s*)/i;
  for (let i = 0; i < text.length; ) {
    const char = text[i];
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (depth === 0) {
      const match = splitters.exec(text.slice(i));
      if (match) { pieces.push(current); current = ""; i += match[0].length; continue; }
    }
    current += char;
    i += 1;
  }
  pieces.push(current);
  return pieces.map(parseOne).filter((name): name is CslName => name !== null);
}

/** The reverse, for showing names back in a single text box. */
export function authorsToText(names: CslName[] | undefined): string {
  if (!names || names.length === 0) return "";
  return names
    .map((name) => {
      if (name.literal) return /[{}]/.test(name.literal) || !ORGANISATION.test(name.literal) ? `{${name.literal}}` : name.literal;
      const given = [name.given, name["non-dropping-particle"]].filter(Boolean).join(" ");
      return [given, name.family, name.suffix].filter(Boolean).join(" ").trim();
    })
    .join(" and ");
}
