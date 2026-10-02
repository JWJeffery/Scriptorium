import assert from "node:assert/strict";
import { matchWordIndexes, parseQuery, normalizeForSearch, matchRank, makeSnippet, lineOfFirstMatch, escapeLike, findFirst } from "../apps/web/lib/search-text.ts";

assert.deepEqual(parseQuery("grace of God"), ["grace", "of", "God"]);
assert.deepEqual(parseQuery('say "grace of God" now'), ["say", "grace of God", "now"]);
assert.deepEqual(parseQuery("  a   b  "), ["a", "b"]);
assert.equal(parseQuery("1 2 3 4 5 6 7 8").length, 6, "terms are capped");

const page = "THE term integ-\nrity has evidently two\nmajor meanings. In the first place";
assert.equal(normalizeForSearch(page), "THE term integrity has evidently two major meanings. In the first place");
assert.equal(matchRank(page, ["integrity"]), 1, "hyphenated line break still matches");
assert.equal(matchRank(page, ["evidently", "two", "major"]), 2, "terms spanning line breaks match as a phrase");
assert.equal(matchRank(page, ["major", "evidently"]), 1, "all terms present but not as a phrase");
assert.equal(matchRank(page, ["absent"]), 0);
assert.equal(matchRank(page, ["MAJOR"]), 1, "case-insensitive");

const snippet = makeSnippet(page, ["evidently two"]);
assert.equal(snippet.match, "evidently two");
assert.ok(snippet.before.endsWith("integrity has ") && snippet.after.startsWith(" major"));
const long = "x ".repeat(300) + "needle" + " y".repeat(300);
const cut = makeSnippet(long, ["needle"]);
assert.ok(cut.before.startsWith("…") && cut.after.endsWith("…") && cut.match === "needle");
assert.equal(findFirst("abc", ["zzz"]), null);

assert.equal(lineOfFirstMatch("one\ntwo\nthree needle\nfour", ["needle"]), 3);
assert.equal(escapeLike("50%_x\\"), "50\\%\\_x\\\\");
const pageWords = ["The", "integrity", "of", "the", "church,", "and", "the", "church's", "integrity", "again."];
assert.deepEqual(matchWordIndexes(pageWords, ["integrity", "of", "the", "church"]), [1, 2, 3, 4], "a contiguous phrase lights exactly that run");
assert.deepEqual(matchWordIndexes(pageWords, ["integrity"]), [1, 8], "single word: every occurrence");
assert.deepEqual(matchWordIndexes(pageWords, ["integrity", "again"]), [8, 9], "adjacent words on the page light as a run");
assert.deepEqual(matchWordIndexes(pageWords, ["integrity", "church"]), [1, 4, 8], "scattered words: each meaningful word");
assert.deepEqual(matchWordIndexes(pageWords, ["of", "the"]), [2, 3], "all-common-words query still highlights the phrase");
assert.deepEqual(matchWordIndexes(pageWords, ["zzz"]), []);

console.log("Search text helpers verified: query parsing, line-break-safe matching, ranking, snippets.");
