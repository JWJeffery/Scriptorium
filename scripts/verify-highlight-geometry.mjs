// Executes the real module: highlights are clipped to the text, one bar per line.
import assert from "node:assert/strict";
import { mergeLineRects, snapRectsToOcrLines } from "../apps/web/lib/highlight-geometry.ts";

// Two lines of OCR words, 20px tall, 30px apart; text spans x=100..410.
const words = [];
for (const [lineTop, jitter] of [[100, [0, 3, -2, 1]], [130, [2, 0, 4, -1]]]) {
  jitter.forEach((j, i) => words.push({ left: 100 + i * 80, top: lineTop + j, width: 70, height: 20 }));
}

const rects = [
  { left: 90, top: 96, width: 400, height: 34 }, // line 1: overhangs both ends and is too tall
  { left: 100, top: 128, width: 150, height: 30 }, // line 2: first part
  { left: 260, top: 131, width: 140, height: 22 }, // line 2: second part, small gap
  { left: 100, top: 600, width: 200, height: 20 } // nowhere near any text
];
const out = snapRectsToOcrLines(rects, words);

assert.equal(out.length, 2, "one bar per line; stray rect dropped");
assert.ok(out[0].left >= 100 && out[0].left + out[0].width <= 410, "clipped to where the words end");
assert.ok(out[0].top + out[0].height < out[1].top, "adjacent lines do not touch");
assert.ok(out[0].height < 20, "painted height is inset below the text height");
assert.equal(out[1].width, 300, "pieces on the same line merge into one bar");

const again = snapRectsToOcrLines(out, words);
assert.deepEqual(again, out, "applying it twice changes nothing");
assert.deepEqual(snapRectsToOcrLines(rects, null), rects, "pages without OCR words are left unchanged");

// One OCR word reported far wider than its letters must not stretch the bar.
const texted = [];
for (let line = 0; line < 3; line += 1) {
  ["alpha", "beta", "gamma", "delta"].forEach((text, i) => texted.push({ text, left: 100 + i * 80, top: 100 + line * 30, width: text.length * 12, height: 20 }));
}
texted[3] = { ...texted[3], width: 900 }; // "delta" on line 1 claims to reach x=1180
const capped = snapRectsToOcrLines([{ left: 90, top: 98, width: 1200, height: 24 }], texted);
assert.equal(capped.length, 1);
assert.ok(capped[0].left + capped[0].width < 100 + 3 * 80 + 5 * 12 * 1.7 + 1, "an over-wide word is capped to a plausible width");

console.log("Highlight geometry verified: clipped to text, one bar per line, idempotent.");

// Seams between the fragments of a line are closed; separate columns and separate lines stay apart.
const fragments = [
  { left: 100, top: 100, width: 60, height: 20 },
  { left: 164, top: 101, width: 70, height: 19 }, // small gap after the first word
  { left: 238, top: 100, width: 50, height: 20 },
  { left: 100, top: 130, width: 80, height: 20 }, // the next line
  { left: 600, top: 100, width: 60, height: 20 } // far to the right: another column
];
const merged = mergeLineRects(fragments);
assert.equal(merged.length, 3, "one bar for the line, one for the next line, one for the far column");
const firstLine = merged.find((rect) => rect.top < 110 && rect.left < 200);
assert.equal(firstLine.left, 100, "the bar starts at the first fragment");
assert.equal(firstLine.left + firstLine.width, 288, "and runs to the end of the last fragment");
assert.ok(firstLine.height < 20 && firstLine.top > 100, "the bar is painted slightly inside the line");
assert.equal(mergeLineRects([]).length, 0, "nothing in, nothing out");
console.log("Line merging verified: fragments on a line join, columns and lines stay apart.");

// Pages without OCR: highlights saved from the PDF's own text layer before its runs were scaled overshoot the
// printed line by however much wider the browser's font was (each line by a different amount). Clipped to the
// text-layer runs (PdfAnchoredPageReader passes them as word boxes), each bar ends where the printed line ends.
const runBoxes = [
  { left: 40, top: 20, width: 360, height: 12, text: "command general consent. That unity, it says, which must be reborn will include" },
  { left: 40, top: 36, width: 360, height: 12, text: "something of all the patterns, not in their falsities and negations but in those" },
  { left: 40, top: 52, width: 360, height: 12, text: "elements of devotion and conviction, of dogma and discipline which they contain." }
];
const saved = [
  { left: 190, top: 19, width: 237, height: 14 }, // starts mid-line, runs 27 units past the line end
  { left: 40, top: 35, width: 364, height: 14 }, // 4 past
  { left: 40, top: 51, width: 380, height: 14 } // 20 past
];
const clipped = snapRectsToOcrLines(saved, runBoxes);
assert.equal(clipped.length, 3, "one bar per line");
assert.ok(clipped.every((rect) => rect.left + rect.width <= 400 + 1e-9), "no bar runs past where the printed line ends");
assert.equal(clipped[0].left, 190, "a highlight that starts mid-line still starts where it did");
assert.deepEqual(snapRectsToOcrLines(clipped, runBoxes), clipped, "clipping twice changes nothing");
console.log("Text-layer clipping verified: saved highlights end where the printed line ends.");

// Trimming to the printed ink: whatever the text layer or OCR claims, a bar ends where the line's ink ends.
{
  const { trimRectsToInk } = await import("../apps/web/lib/highlight-geometry.ts");
  const width = 500, height = 100;
  const dark = new Uint8Array(width * height);
  const ink = (x0, x1, y0, y1) => { for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) dark[y * width + x] = 1; };
  ink(40, 300, 20, 30); // line 1: words from x=40 to x=300, with gaps between words
  for (let x = 120; x < 130; x += 1) for (let y = 20; y < 30; y += 1) dark[y * width + x] = 0;
  ink(40, 400, 40, 50); // line 2 runs to the margin at x=400
  dark[60 * width + 450] = 1; // a lone speck of scan noise on line 3
  ink(40, 200, 58, 68); // line 3 ends at x=200
  const grid = { width, height, scale: 1, dark };
  const bars = [
    { left: 100, top: 21, width: 320, height: 8 }, // starts mid-line, claims to run to 420
    { left: 40, top: 41, width: 360, height: 8 }, // already right
    { left: 40, top: 59, width: 430, height: 8 }, // claims to run to 470, past a noise speck
    { left: 40, top: 81, width: 100, height: 8 } // no ink under it at all
  ];
  const trimmed = trimRectsToInk(bars, grid);
  const right = (r) => r.left + r.width;
  assert.ok(Math.abs(right(trimmed[0]) - 300) < 2, "line 1 ends where its ink ends, not where the text layer said");
  assert.equal(trimmed[0].left >= 100, true, "a bar is never lengthened at the start");
  assert.ok(right(trimmed[1]) <= 400 && right(trimmed[1]) > 398, "a bar already at the line end stays there");
  assert.ok(Math.abs(right(trimmed[2]) - 200) < 2, "a lone speck of noise past the line does not stretch the bar");
  assert.deepEqual(trimmed[3], bars[3], "a bar with no ink under it is left as it is");
  assert.deepEqual(trimRectsToInk(trimmed, grid), trimmed, "trimming twice changes nothing");
  assert.deepEqual(trimRectsToInk(bars, null), bars, "no ink map: unchanged");
  console.log("Ink trimming verified: each bar ends where the printed line ends.");
}
