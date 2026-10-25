import { createHash } from "node:crypto";

// Pure helpers for search-by-meaning: cutting a page into passages and comparing vectors.

export type Chunk = { start: number; end: number; text: string };

/**
 * Cut text into overlapping passages of roughly `maxWords` words. The model reads
 * about 256 tokens (about 180 English words), so a long page is several passages.
 * Offsets point back into the original text.
 */
export function chunkText(text: string, maxWords = 170, overlapWords = 30): Chunk[] {
  const words: Array<{ start: number; end: number }> = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) words.push({ start: match.index, end: match.index + match[0].length });
  if (words.length === 0) return [];
  if (words.length <= maxWords) return [{ start: words[0].start, end: words[words.length - 1].end, text: text.slice(words[0].start, words[words.length - 1].end) }];

  const chunks: Chunk[] = [];
  const step = Math.max(1, maxWords - overlapWords);
  for (let first = 0; first < words.length; first += step) {
    const last = Math.min(first + maxWords, words.length) - 1;
    const start = words[first].start;
    const end = words[last].end;
    chunks.push({ start, end, text: text.slice(start, end) });
    if (last === words.length - 1) break;
  }
  return chunks;
}

export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) sum += vector[i] * vector[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i] / norm;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) sum += a[i] * b[i];
  return sum;
}

export function vectorToBytes(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bytesToVector(bytes: Uint8Array): Float32Array {
  // Copy: the database driver's buffer may not be 4-byte aligned.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export function textHash(text: string) {
  return createHash("sha1").update(text).digest("hex");
}

export type Scored<T> = { item: T; score: number };

/** The k best-scoring items, best first. */
export function topK<T>(scored: Array<Scored<T>>, k: number): Array<Scored<T>> {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, k);
}
