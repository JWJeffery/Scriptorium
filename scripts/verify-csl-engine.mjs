// Runs the real citeproc-js engine with the real style files.
import assert from "node:assert/strict";
import { formatCitations, formatBibliography, missingCitationFields, htmlToText, isStyleKey } from "../apps/web/lib/csl-engine.ts";
import { parseAuthors, authorsToText } from "../apps/web/lib/author-names.ts";

// --- author names
assert.deepEqual(parseAuthors("Stephen W. Sykes"), [{ family: "Sykes", given: "Stephen W." }]);
assert.deepEqual(parseAuthors("Sykes, Stephen W."), [{ family: "Sykes", given: "Stephen W." }]);
assert.deepEqual(parseAuthors("Martin Luther King Jr."), [{ family: "King", given: "Martin Luther", suffix: "Jr." }]);
assert.deepEqual(parseAuthors("Ludwig van Beethoven"), [{ family: "van Beethoven", given: "Ludwig" }]);
assert.equal(parseAuthors("A. Smith and Brian Jones").length, 2);
assert.deepEqual(parseAuthors("{World Council of Churches}"), [{ literal: "World Council of Churches" }]);
assert.deepEqual(parseAuthors("World Council of Churches"), [{ literal: "World Council of Churches" }], "organisations are recognised");
assert.deepEqual(parseAuthors(""), []);
assert.equal(authorsToText(parseAuthors("Stephen W. Sykes and Ann Lee")), "Stephen W. Sykes and Ann Lee");

const sykes = { type: "book", title: "The Integrity of Anglicanism", author: [{ literal: "Stephen W. Sykes" }], publisher: "A.R. Mowbray", "publisher-place": "New York", issued: { "date-parts": [[1978]] } };
const smith = { type: "book", title: "Another Book", author: [{ family: "Smith", given: "John" }], publisher: "Press", issued: { "date-parts": [[2001]] } };

// --- SBL notes: first mention full, later mentions short, per the official style
const notes = formatCitations("sbl-note", [
  { key: "sykes", csl: sykes, locator: "12" },
  { key: "smith", csl: smith, locator: "3" },
  { key: "sykes", csl: sykes, locator: "15" },
  { key: "sykes", csl: sykes, locator: "iv" }
], "sequence");
assert.equal(notes[0].text, "Stephen W. Sykes, The Integrity of Anglicanism (A.R. Mowbray, 1978), 12.");
assert.ok(notes[0].html.includes("<i>The Integrity of Anglicanism</i>"), "titles are italic");
assert.equal(notes[1].text, "John Smith, Another Book (Press, 2001), 3.");
assert.equal(notes[2].text, "Sykes, The Integrity of Anglicanism, 15.", "a repeat reference is shortened");
assert.equal(notes[3].text, "Sykes, The Integrity of Anglicanism, iv.", "Roman page numbers pass through");

// --- each: every citation stands alone as a first note
const alone = formatCitations("sbl-note", [{ key: "sykes", csl: sykes, locator: "12" }, { key: "sykes", csl: sykes, locator: "15" }], "each");
assert.equal(alone[1].text, "Stephen W. Sykes, The Integrity of Anglicanism (A.R. Mowbray, 1978), 15.");

// --- Chicago keeps the place; the other styles
assert.equal(formatCitations("chicago-note", [{ key: "sykes", csl: sykes, locator: "12" }])[0].text, "Stephen W. Sykes, The Integrity of Anglicanism (A.R. Mowbray, 1978), 12.");
assert.equal(formatCitations("turabian-note", [{ key: "sykes", csl: sykes, locator: "12" }])[0].text.slice(0, 11), "Stephen W. ");
assert.equal(formatCitations("apa", [{ key: "sykes", csl: sykes, locator: "12" }])[0].text, "(Sykes, 1978, p. 12)");
assert.equal(formatCitations("mla", [{ key: "sykes", csl: sykes, locator: "12" }])[0].text, "(Sykes 12)");
assert.equal(formatCitations("harvard", [{ key: "sykes", csl: sykes, locator: "12" }])[0].text, "(Sykes, 1978, p. 12)");

// --- no locator, no author
assert.equal(formatCitations("sbl-note", [{ key: "a", csl: sykes }])[0].text, "Stephen W. Sykes, The Integrity of Anglicanism (A.R. Mowbray, 1978).");
const anonymous = formatCitations("sbl-note", [{ key: "b", csl: { type: "book", title: "Anonymous Treatise", publisher: "P", issued: { "date-parts": [[1900]] } }, locator: "2" }])[0].text;
assert.ok(anonymous.startsWith("Anonymous Treatise") && !/Unknown/.test(anonymous), "no invented 'Unknown author'");

// --- bibliography
const bibliography = formatBibliography("sbl-note", [{ key: "smith", csl: smith }, { key: "sykes", csl: sykes }]);
assert.equal(bibliography.length, 2);
assert.ok(bibliography[0].text.startsWith("Smith, John.") && bibliography[1].text.startsWith("Sykes, Stephen W."), "alphabetical, surname first");

// --- missing metadata is named plainly
assert.deepEqual(missingCitationFields(sykes), []);
assert.deepEqual(missingCitationFields({ title: "Only a title" }), ["author", "year", "publisher"]);
assert.deepEqual(missingCitationFields({ type: "article-journal", title: "T", author: [{ family: "A", given: "B" }], issued: { "date-parts": [[1999]] } }), []);

assert.equal(htmlToText("Smith &#38; Jones <i>Title</i> &amp; more"), "Smith & Jones Title & more");
assert.ok(isStyleKey("sbl-note") && !isStyleKey("nope"));
console.log("CSL engine verified: official SBL/Chicago/APA/MLA/Harvard styles, short forms, bibliography, author parsing, missing-field warnings.");
