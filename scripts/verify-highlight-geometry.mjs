// Executes the real module: highlights are clipped to the text, one bar per line.
import assert from "node:assert/strict";
import { snapRectsToOcrLines } from "../apps/web/lib/highlight-geometry.ts";

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
