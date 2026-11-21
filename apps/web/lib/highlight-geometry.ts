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
export type GeometryWord = { left: number; top: number; width: number; height: number; text?: string };

type Line = { top: number; bottom: number; left: number; right: number; textTop: number; textHeight: number };

const HEIGHT_INSET = 0.88; // fraction of the median word height that is painted
const MERGE_GAP = 1.5; // merge pieces on one line if the gap is under this many line-heights

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// OCR sometimes reports one word far wider than its letters (a scan edge or
// shadow read as part of the word). Cap each word's width at a multiple of the
// page's typical width per character so one bad box cannot stretch a line.
const MAX_WIDTH_PER_CHAR = 1.7; // times the page's median width per character

function capOutlierWidths(words: GeometryWord[]): GeometryWord[] {
  const perChar = words.filter((w) => w.text && w.text.length >= 2 && w.width > 0).map((w) => w.width / (w.text as string).length);
  if (perChar.length < 5) return words;
  const limit = median(perChar) * MAX_WIDTH_PER_CHAR;
  return words.map((w) => {
    if (!w.text) return w;
    const maxWidth = Math.max(w.text.length, 2) * limit;
    return w.width > maxWidth ? { ...w, width: maxWidth } : w;
  });
}

function buildLines(rawWords: GeometryWord[]): Line[] {
  const words = capOutlierWidths(rawWords);
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

/**
 * Merges the pieces of a highlight that sit on one line into a single bar, so a highlight reads as one
 * clean stripe per line instead of a row of separate boxes with seams between them. Pieces further apart
 * than about a word or two (another column) stay separate. Each bar is painted slightly inside the line
 * so stripes on neighbouring lines never touch.
 */
export function mergeLineRects(rects: GeometryRect[]): GeometryRect[] {
  const lines: GeometryRect[] = rects.filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({ ...rect }));
  const joinable = (a: GeometryRect, b: GeometryRect) => {
    const tall = Math.max(a.height, b.height);
    const sameLine = Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < tall * 0.5;
    const gap = Math.max(b.left - (a.left + a.width), a.left - (b.left + b.width));
    return sameLine && gap <= tall * 1.5;
  };
  // Joining can bring two earlier bars within reach of each other, so repeat until nothing changes.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < lines.length && !changed; i += 1) {
      for (let j = i + 1; j < lines.length; j += 1) {
        if (!joinable(lines[i], lines[j])) continue;
        const left = Math.min(lines[i].left, lines[j].left);
        const top = Math.min(lines[i].top, lines[j].top);
        const right = Math.max(lines[i].left + lines[i].width, lines[j].left + lines[j].width);
        const bottom = Math.max(lines[i].top + lines[i].height, lines[j].top + lines[j].height);
        lines[i] = { left, top, width: right - left, height: bottom - top };
        lines.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return lines
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((line) => ({ left: line.left, top: line.top + line.height * 0.1, width: line.width, height: line.height * 0.8 }));
}
