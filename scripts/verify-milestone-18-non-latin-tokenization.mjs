// Requires Node 22.6+ run with --experimental-strip-types.
//
// Before this fix, tokenizeForSimilarity split on /[^a-z0-9]+/ — ASCII only.
// Any text in Greek, Ge'ez/Ethiopic, Syriac, Coptic, or other non-Latin
// scripts common in patristic/liturgical sources contains no characters in
// that class, so it tokenized to an empty array and was invisible to
// search/similarity scoring. This verifier proves real script samples now
// tokenize and score correctly, and that English tokenization/stemming is
// unchanged.

import assert from "node:assert/strict";
import { tokenizeForSimilarity, cosineSimilarity } from "../apps/web/lib/local-similarity.ts";

const samples = {
  greek: "Ο Λόγος ἦν πρὸς τὸν Θεόν",
  geez: "በስመ አብ ወወልድ ወመንፈስ ቅዱስ",
  syriac: "ܒܪܫܝܬ ܐܝܬܘܗܝ ܗܘܐ ܡܠܬܐ"
};

for (const [script, text] of Object.entries(samples)) {
  const tokens = tokenizeForSimilarity(text);
  assert.ok(tokens.length > 0, `${script} sample must produce at least one token (previously produced zero)`);
  assert.ok(
    tokens.every((token) => token.length >= 2),
    `${script} tokens must respect the minimum length filter`
  );
}

// A non-Latin passage must register non-zero similarity against an
// overlapping excerpt of itself — this is the actual search-usability bar,
// not just "tokenizes to something."
const greekOverlap = cosineSimilarity(samples.greek, "Λόγος πρὸς Θεόν");
assert.ok(greekOverlap > 0.5, `Greek self-similarity should score high, got ${greekOverlap}`);

const geezOverlap = cosineSimilarity(samples.geez, "አብ ወወልድ");
assert.ok(geezOverlap > 0.3, `Ge'ez self-similarity should score above zero, got ${geezOverlap}`);

// Unrelated scripts must not falsely match each other.
const crossScript = cosineSimilarity(samples.greek, samples.syriac);
assert.equal(crossScript, 0, "unrelated scripts with no shared tokens must score zero, not a false positive");

// English tokenization/stemming must be unaffected by the Unicode change.
const english = tokenizeForSimilarity("The monastic prayer rule was established");
assert.deepEqual(english, ["monastic", "prayer", "rule", "wa", "establish"]);

console.log("Milestone 18 non-Latin script tokenization verifier passed.");
