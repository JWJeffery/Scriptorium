// ISBN/DOI validation, lookup mapping (with simulated services), and bibliography import.
import assert from "node:assert/strict";
import { normalizeIsbn, normalizeDoi, lookupIsbn, lookupDoi, openLibraryToCsl } from "../apps/web/lib/source-lookup.ts";
import { parseBibliographyText } from "../apps/web/lib/source-import.ts";

// --- ISBN: checksums, hyphens, ISBN-10 upgraded to ISBN-13
assert.equal(normalizeIsbn("978-0-14-044913-6"), "9780140449136");
assert.equal(normalizeIsbn("ISBN 9780140449136"), "9780140449136");
assert.equal(normalizeIsbn("0140449132"), "9780140449136", "ISBN-10 becomes ISBN-13");
assert.equal(normalizeIsbn("0802827535"), "9780802827531");
assert.equal(normalizeIsbn("0-9752298-0-X"), "9780975229804", "an ISBN-10 ending in X");
assert.equal(normalizeIsbn("9780140449137"), null, "wrong check digit is refused");
assert.equal(normalizeIsbn("12345"), null);
assert.equal(normalizeIsbn("not an isbn"), null);

// --- DOI: URL forms and junk
assert.equal(normalizeDoi("10.1038/nature12373"), "10.1038/nature12373");
assert.equal(normalizeDoi("https://doi.org/10.1038/nature12373"), "10.1038/nature12373");
assert.equal(normalizeDoi("doi: 10.1038/nature12373"), "10.1038/nature12373");
assert.equal(normalizeDoi("http://evil.example/10.1038/x"), null, "only doi.org forms are accepted");
assert.equal(normalizeDoi("10.1/short"), null);

// --- Open Library mapping
const mapped = openLibraryToCsl({ title: "Educating for Shalom", subtitle: "Essays on Christian Higher Education", authors: [{ name: "Nicholas Wolterstorff" }, { name: "Clarence W. Joldersma" }], publishers: [{ name: "Wm. B. Eerdmans" }], publish_places: [{ name: "Grand Rapids" }], publish_date: "February 2004" }, "9780802827531");
assert.equal(mapped.title, "Educating for Shalom: Essays on Christian Higher Education");
assert.deepEqual(mapped.author, [{ family: "Wolterstorff", given: "Nicholas" }, { family: "Joldersma", given: "Clarence W." }]);
assert.deepEqual(mapped.issued, { "date-parts": [[2004]] });
assert.equal(mapped["publisher-place"], "Grand Rapids");

// --- Lookups through simulated services; the person's text never becomes a URL
const calls = [];
const fakeFetch = (routes) => async (url, init) => {
  calls.push(String(url));
  for (const [needle, body] of Object.entries(routes)) if (String(url).includes(needle)) return new Response(JSON.stringify(body), { status: body === null ? 404 : 200, headers: { "content-type": "application/json" } });
  return new Response("{}", { status: 404 });
};
const viaOpenLibrary = await lookupIsbn("9780802827531", fakeFetch({ "openlibrary.org": { "ISBN:9780802827531": { title: "Educating for Shalom", authors: [{ name: "Nicholas Wolterstorff" }] } } }));
assert.equal(viaOpenLibrary.provider, "Open Library");
const viaGoogle = await lookupIsbn("9780802827531", fakeFetch({ "openlibrary.org": {}, "googleapis.com": { items: [{ volumeInfo: { title: "Fallback Title", authors: ["Ann Lee"], publisher: "P", publishedDate: "1999-05-01" } }] } }));
assert.equal(viaGoogle.provider, "Google Books");
assert.deepEqual(viaGoogle.csl.issued, { "date-parts": [[1999]] });
assert.equal(await lookupIsbn("9780802827531", fakeFetch({})), null, "not found anywhere");
const viaDoi = await lookupDoi("10.1038/nature12373", fakeFetch({ "doi.org": { type: "journal-article", title: "Nanometre-scale thermometry", author: [{ family: "Kucsko", given: "G.", sequence: "first", affiliation: [] }], "container-title": "Nature", volume: "500", issued: { "date-parts": [[2013, 7, 31]] }, indexed: { x: 1 }, reference: [{ big: true }], license: [] } }));
assert.equal(viaDoi.csl.title, "Nanometre-scale thermometry");
assert.equal(viaDoi.csl.DOI, "10.1038/nature12373");
assert.equal(viaDoi.csl.type, "article-journal", "Crossref type names are translated");
assert.deepEqual(viaDoi.csl.author, [{ family: "Kucsko", given: "G." }], "extra author fields are trimmed");
assert.ok(!("reference" in viaDoi.csl) && !("indexed" in viaDoi.csl), "bulky registry data is dropped");
assert.ok(calls.every((url) => /^https:\/\/(openlibrary\.org|www\.googleapis\.com|doi\.org)\//.test(url)), "only the fixed services are contacted");

// --- Import: the formats Zotero exports
const bibtex = `@book{sykes1978, author = {Sykes, Stephen W. and Booty, John}, title = {The Integrity of Anglicanism}, publisher = {A.R. Mowbray}, address = {New York}, year = {1978}}
@article{lee1999, author = {Lee, Ann}, title = {On Unity}, journal = {Journal of Theology}, volume = {12}, pages = {1--20}, year = {1999}}`;
const fromBib = parseBibliographyText(bibtex);
assert.equal(fromBib.length, 2);
assert.equal(fromBib[0].title, "The Integrity of Anglicanism");
assert.equal(fromBib[0].author.length, 2);
assert.equal(fromBib[1]["container-title"], "Journal of Theology");
assert.ok(!("_graph" in fromBib[0]) && !("id" in fromBib[0]), "parser bookkeeping is removed");
const fromRis = parseBibliographyText("TY  - BOOK\nAU  - Sykes, Stephen W.\nTI  - The Integrity of Anglicanism\nPY  - 1978\nPB  - A.R. Mowbray\nCY  - New York\nER  - \n");
assert.equal(fromRis[0]["publisher-place"], "New York");
const fromJson = parseBibliographyText('[{"type":"book","title":"T","author":[{"family":"A","given":"B"}]}]');
assert.equal(fromJson[0].title, "T");
assert.throws(() => parseBibliographyText("this is not a bibliography"), /does not look like/);
assert.throws(() => parseBibliographyText("   "), /empty/);

console.log("Source lookup and import verified: ISBN/DOI validation, Open Library/Google/DOI mapping, fixed hosts only, BibTeX/RIS/CSL JSON import.");
