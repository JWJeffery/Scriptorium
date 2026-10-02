import assert from "node:assert/strict";
import { chunkText, normalize, dot, vectorToBytes, bytesToVector, topK, textHash } from "../apps/web/lib/embedding-math.ts";

// --- chunking
assert.deepEqual(chunkText(""), []);
assert.deepEqual(chunkText("   \n "), []);
const short = chunkText("A short page of text.");
assert.equal(short.length, 1);
assert.equal(short[0].text, "A short page of text.");

const words = Array.from({ length: 400 }, (_, i) => `w${i}`);
const text = words.join(" ");
const chunks = chunkText(text, 170, 30);
assert.ok(chunks.length >= 3, "a long page becomes several passages");
for (const chunk of chunks) {
  assert.equal(text.slice(chunk.start, chunk.end), chunk.text, "offsets point back into the original text");
  assert.ok(chunk.text.split(/\s+/).length <= 170);
}
assert.ok(chunks[0].text.split(" ").slice(-30).join(" ").includes("w169") && chunks[1].text.startsWith("w140"), "passages overlap by 30 words");
assert.ok(chunks[chunks.length - 1].text.endsWith("w399"), "the last word is covered");
const covered = new Set(chunks.flatMap((chunk) => chunk.text.split(" ")));
assert.equal(covered.size, 400, "no word is left out");

// --- vectors
const v = normalize(Float32Array.from([3, 4]));
assert.ok(Math.abs(dot(v, v) - 1) < 1e-6, "normalised vectors have length 1");
assert.ok(Math.abs(dot(normalize(Float32Array.from([1, 0])), normalize(Float32Array.from([0, 1])))) < 1e-6, "unrelated = 0");
assert.deepEqual(Array.from(normalize(new Float32Array(3))), [0, 0, 0], "a zero vector does not blow up");
const roundTrip = bytesToVector(vectorToBytes(Float32Array.from([0.25, -1.5, 3])));
assert.deepEqual(Array.from(roundTrip), [0.25, -1.5, 3], "vectors survive being stored as bytes");
const unaligned = Buffer.concat([Buffer.from([9]), Buffer.from(vectorToBytes(Float32Array.from([1, 2])))]).subarray(1);
assert.deepEqual(Array.from(bytesToVector(unaligned)), [1, 2], "an unaligned database buffer is handled");

assert.deepEqual(topK([{ item: "a", score: 0.2 }, { item: "b", score: 0.9 }, { item: "c", score: 0.5 }], 2).map((entry) => entry.item), ["b", "c"]);
assert.equal(textHash("same"), textHash("same"));
assert.notEqual(textHash("a"), textHash("b"));
console.log("Embedding math verified: passage chunking with overlap and offsets, vector maths, byte round-trip, top-k.");
