// Tightens highlight rectangles on OCR'd pages.
//
// The browser reports one box per text fragment, and those boxes overhang the
// end of a line (a trailing space or newline), bob up and down with each
// word's ascenders/descenders, and overlap neighbouring lines. Highlights
// drawn from them look ragged and can spill past the text into the margin.
//
// OCR gives us the true word positions, so each rectangle is snapped to the
// line of words it overlaps: clipped to where the line's words actually start
// and end, set to that line's typical text height (slightly inset so adjacent
// lines never touch), and merged into one bar per line. Every value is derived
// from the OCR words, never from the input rectangle's own height, so applying
// this twice gives the same result.

export type GeometryRect = { left: number; top: number; width: number; height: number };
export type GeometryWord = { left: number; top: number; width: number; height: number };

type Line = { top: number; bottom: number; left: number; right: number; textTop: number; textHeight: number };

const HEIGHT_INSET = 0.88; // fraction of the median word height that is painted
const MERGE_GAP = 1.5; // merge pieces on one line if the gap is under this many line-heights

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildLines(words: GeometryWord[]): Line[] {
  const sorted = [...words].filter((w) => w.width > 0 && w.height > 0).sort((a, b) => a.top - b.top || a.left - b.left);
  const groups: { words: GeometryWord[]; top: number; bottom: number }[] = [];
  for (const word of sorted) {
    const mid = word.top + word.height / 2;
    const group = groups.find((candidate) => mid >= candidate.top && mid <= candidate.bottom);
    if (group) {
      group.words.push(word);
      group.top = Math.min(group.top, word.top);
      group.bottom = Math.max(group.bottom, word.top + word.height);
    } else {
      groups.push({ words: [word], top: word.top, bottom: word.top + word.height });
    }
  }
  return groups.map((group) => ({
    top: group.top,
    bottom: group.bottom,
    left: Math.min(...group.words.map((w) => w.left)),
    right: Math.max(...group.words.map((w) => w.left + w.width)),
    textTop: median(group.words.map((w) => w.top)),
    textHeight: median(group.words.map((w) => w.height))
  }));
}

export function snapRectsToOcrLines(rects: GeometryRect[], words: GeometryWord[] | null | undefined): GeometryRect[] {
  if (!words || words.length === 0 || rects.length === 0) return rects;
  const lines = buildLines(words);
  if (lines.length === 0) return rects;

  const perLine = new Map<Line, { left: number; right: number }[]>();
  for (const rect of rects) {
    const mid = rect.top + rect.height / 2;
    const line = lines.find((candidate) => mid >= candidate.top && mid <= candidate.bottom);
    if (!line) continue; // not over any recognised text: drop it
    const left = Math.max(rect.left, line.left);
    const right = Math.min(rect.left + rect.width, line.right);
    if (right - left <= 0) continue;
    const pieces = perLine.get(line) ?? [];
    pieces.push({ left, right });
    perLine.set(line, pieces);
  }

  const result: GeometryRect[] = [];
  for (const line of lines) {
    const pieces = perLine.get(line);
    if (!pieces) continue;
    pieces.sort((a, b) => a.left - b.left);
    const merged: { left: number; right: number }[] = [];
    for (const piece of pieces) {
      const last = merged[merged.length - 1];
      if (last && piece.left - last.right <= line.textHeight * MERGE_GAP) last.right = Math.max(last.right, piece.right);
      else merged.push({ ...piece });
    }
    const height = line.textHeight * HEIGHT_INSET;
    const top = line.textTop + (line.textHeight - height) / 2;
    for (const piece of merged) result.push({ left: piece.left, top, width: piece.right - piece.left, height });
  }
  return result.sort((a, b) => a.top - b.top || a.left - b.left);
}
