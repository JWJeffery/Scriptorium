// Database-level check of the search indexes (migration 20261122010000_search_indexes):
//   1. exact search's ILIKE query uses the pg_trgm GIN index on page text (EXPLAIN), and returns the
//      same rows as a full scan;
//   2. the SQL function that filled the pgvector column decodes stored Float32Array bytes bit for bit;
//   3. search by meaning in the database returns the same results as the former in-memory method
//      (exact strategy), and the HNSW strategy uses its index and finds nearly all of them;
//   4. rows whose vector column is empty are filled on the fly; unreadable ones are skipped.
// Needs DATABASE_URL (a migrated, throwaway database). Adds fixture books and removes them again.
// Run from the repository root: node scripts/verify-search-indexes.mjs (KEEP_FIXTURE=1 leaves the fixture
// books in place, to EXPLAIN by hand).
import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.SCRIPTORIUM_FAKE_EMBEDDINGS = "1";
const { prisma } = await import("../apps/web/lib/prisma.ts");
const { exactPageQuery, exactPageRows, exactSearchSettings } = await import("../apps/web/lib/search-queries.ts");
const { searchByMeaning, fillMissingVectors, indexDocument, meaningScope, nearestPassagesQuery, vectorLiteral } = await import("../apps/web/lib/meaning-index.ts");
const { activeModelName, embedTexts } = await import("../apps/web/lib/embeddings.ts");
const { bytesToVector, dot, topK, vectorToBytes } = await import("../apps/web/lib/embedding-math.ts");
const { Prisma } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@prisma/client");

const stamp = Date.now();
const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function timed(fn, runs = 5) {
  const times = [];
  let result;
  for (let i = 0; i < runs; i += 1) { const start = process.hrtime.bigint(); result = await fn(); times.push(ms(start)); }
  return { result, ms: median(times) };
}
const planNodes = (plan) => [plan, ...(plan.Plans ?? []).flatMap(planNodes)];
async function explain(query, settings = []) {
  return prisma.$transaction(async (tx) => {
    for (const setting of settings) await tx.$executeRawUnsafe(setting);
    const [row] = await tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${query.text}`, ...query.values);
    return row["QUERY PLAN"][0];
  });
}
async function runWith(query, settings) {
  return prisma.$transaction(async (tx) => {
    for (const setting of settings) await tx.$executeRawUnsafe(setting);
    return tx.$queryRaw(query);
  });
}

// A deterministic pseudo-random generator, so every run builds the same fixture.
let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const vocabulary = Array.from({ length: 3000 }, (_, i) => `w${(i * 7919).toString(36)}${"aeiou"[i % 5]}`);
const words = (count) => Array.from({ length: count }, () => vocabulary[Math.floor(random() * vocabulary.length)]).join(" ");
// Page text for the trigram test: ordinary English prose vocabulary, so trigram frequencies are like
// a real library's (random strings would make an unrealistically huge, unselective index).
const english = ("the of and to in a is that for it as was with be by on not he this are or his from at which but have an they " +
  "one you were her all she there would their we him been has when who will more no if out so said what up its about into than them " +
  "can only other new some could time these two may then do first any my now such like our over man me even most made after also did " +
  "many before must through back years where much your way well down should because each just those people how too little state good " +
  "very make world still own see men work long get here between both life being under never day same another know while last might us " +
  "great old year off come since against go came right used take three church council bishop grace faith doctrine creed synod canon " +
  "scripture gospel apostle liturgy baptism eucharist monastery abbot prayer fasting feast saint martyr relic icon hymn psalm spirit " +
  "father son holy virgin mother divine nature person heresy orthodox tradition fathers commentary letter homily sermon treatise").split(" ");
const prose = (count) => Array.from({ length: count }, () => english[Math.floor(random() * english.length)]).join(" ");

async function fixtureBook(title, pages) {
  const document = await prisma.document.create({ data: { title, kind: "PDF" } });
  const version = await prisma.documentVersion.create({ data: { documentId: document.id, snapshotKind: "PDF_RENDERING" } });
  for (let i = 0; i < pages.length; i += 1000) {
    await prisma.textSpan.createMany({ data: pages.slice(i, i + 1000).map((text, offset) => ({ versionId: version.id, text, anchor: { pdfPageIndex: i + offset + 1 } })) });
  }
  return document.id;
}

const created = [];
try {
  // --- 0. the migration's objects exist
  const indexes = new Set((await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename IN ('TextSpan', 'PassageEmbedding')`).map((row) => row.indexname));
  for (const name of ["TextSpan_text_trgm_idx", "PassageEmbedding_embedding_hnsw_idx", "PassageEmbedding_model_documentId_idx", "PassageEmbedding_embedding_missing_idx"]) assert.ok(indexes.has(name), `index ${name} exists`);
  const [{ version: pgvector }] = await prisma.$queryRaw`SELECT extversion AS version FROM pg_extension WHERE extname = 'vector'`;

  // --- 1. exact search on a few thousand pages of text (about 300 words each, like a scanned book)
  const BOOKS = 20;
  const PAGES_PER_BOOK = 250;
  const PAGES = BOOKS * PAGES_PER_BOOK;
  for (let book = 0; book < BOOKS; book += 1) {
    const pages = Array.from({ length: PAGES_PER_BOOK }, (_, page) => {
      const i = book * PAGES_PER_BOOK + page;
      let text = prose(300);
      if (i % 500 === 7) text += " the Theotokos of Kazan";
      if (i % 1000 === 3) text += " 50%_literal";
      return text;
    });
    created.push(await fixtureBook(`Trigram fixture ${stamp} book ${book}`, pages));
  }
  // As autovacuum would after a bulk import: statistics, and the GIN index's pending list merged.
  await prisma.$executeRawUnsafe(`VACUUM ANALYZE "TextSpan"`);
  await prisma.$executeRawUnsafe(`ANALYZE "DocumentVersion", "Document"`);
  const fullScan = ["SET LOCAL enable_bitmapscan = off", "SET LOCAL enable_indexscan = off"];
  const describe = (plan) => planNodes(plan.Plan).map((node) => node["Node Type"] + (node["Index Name"] ? `(${node["Index Name"]})` : node["Relation Name"] ? `(${node["Relation Name"]})` : "")).join(" > ");
  const cases = [
    { terms: ["theotokos"], documentId: "", expected: PAGES / 500 },
    { terms: ["Theotokos", "kazan"], documentId: "", expected: PAGES / 500 },
    { terms: ["the", "Theotokos", "of"], documentId: "", expected: PAGES / 500 }, // "of" alone has no trigram
    { terms: ["50%_lit"], documentId: "", expected: PAGES / 1000 }, // LIKE wildcards are matched literally
    { terms: ["theotokos"], documentId: created[0], expected: 1 } // within one book
  ];
  for (const { terms, documentId, expected } of cases) {
    const query = exactPageQuery(terms, documentId);
    const plan = await explain(query, exactSearchSettings(terms));
    const nodes = planNodes(plan.Plan);
    assert.ok(!nodes.some((node) => node["Node Type"] === "Seq Scan" && node["Relation Name"] === "TextSpan"), `exact search for ${JSON.stringify(terms)} does not read every page: ${describe(plan)}`);
    if (!documentId) assert.ok(nodes.some((node) => node["Index Name"] === "TextSpan_text_trgm_idx"), `library-wide exact search for ${JSON.stringify(terms)} uses the trigram index: ${describe(plan)}`);
    const indexed = await timed(() => exactPageRows(terms, documentId));
    const scanned = await timed(() => runWith(query, fullScan));
    assert.deepEqual(indexed.result.map((row) => row.id).sort(), scanned.result.map((row) => row.id).sort(), "same rows as a full scan");
    assert.ok(indexed.result.length >= expected, `found the ${expected} fixture pages`);
    for (const row of indexed.result) assert.ok(terms.every((term) => row.text.toLowerCase().includes(term.toLowerCase())));
    console.log(`exact ${JSON.stringify(terms)}${documentId ? " (one book)" : ""}: ${indexed.result.length} rows, ${indexed.ms.toFixed(1)} ms vs full scan ${scanned.ms.toFixed(1)} ms (${PAGES} pages); plan: ${describe(plan)}`);
  }
  assert.deepEqual(exactSearchSettings(["of", "a"]), [], "terms too short for trigrams are left to the planner");

  // --- 2. the backfill function decodes bytes exactly
  const specials = [0, 1, -1, 1e-45, -1e-45, 1.17549435e-38, 1.1754942e-38, 3.4028235e38, -3.4028235e38, 0.1, -0.333333, 1e-7, 123456.789];
  for (const length of [384, 64, 1]) {
    const vector = new Float32Array(length);
    for (let i = 0; i < length; i += 1) vector[i] = i < specials.length ? specials[i] : (random() - 0.5) * 0.3;
    const [row] = await prisma.$queryRaw`SELECT scriptorium_bytes_to_vector(${vectorToBytes(vector)})::text AS v`;
    const decoded = Float32Array.from(JSON.parse(row.v));
    assert.equal(decoded.length, 384, "padded to the column width");
    for (let i = 0; i < 384; i += 1) assert.equal(decoded[i], i < length ? vector[i] : 0, `number ${i} of a ${length}-number vector`);
  }
  const [bad] = await prisma.$queryRaw`SELECT scriptorium_bytes_to_vector(${Buffer.from([1, 2, 3])}) IS NULL AS a, scriptorium_bytes_to_vector(${Buffer.alloc(385 * 4)}) IS NULL AS b, scriptorium_bytes_to_vector(${vectorToBytes(new Float32Array([Infinity]))}) IS NULL AS c`;
  assert.deepEqual(bad, { a: true, b: true, c: true }, "malformed bytes give NULL, not an error");
  console.log("backfill function: bit-exact for 384/64/1-number vectors incl. subnormals and extremes; malformed input -> NULL");

  // --- 3. meaning search: the database against the former in-memory method
  const model = activeModelName();
  // Pages of 60-400 words: long ones become several passages, so "one passage per page" is exercised.
  const meaningPages = Array.from({ length: 2500 }, () => words(60 + Math.floor(random() * 340)));
  const meaningBook = await fixtureBook(`Meaning index fixture ${stamp}`, meaningPages);
  created.push(meaningBook);
  const indexing = await timed(() => indexDocument(meaningBook), 1);
  const passages = indexing.result.passages;
  console.log(`indexed ${passages} passages from ${meaningPages.length} pages in ${indexing.ms.toFixed(0)} ms`);
  await prisma.$executeRawUnsafe(`ANALYZE "PassageEmbedding"`);

  // The search exactly as it was before (copied from the former lib/meaning-index.ts).
  async function inMemorySearch(query, documentIds, limit) {
    const rows = [];
    let cursor;
    for (;;) {
      const page = await prisma.passageEmbedding.findMany({ where: { model, document: { deletedAt: null }, ...(documentIds ? { documentId: { in: documentIds } } : {}) }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
      if (page.length === 0) break;
      for (const row of page) rows.push({ documentId: row.documentId, kind: row.kind, refId: row.refId, pdfPage: row.pdfPage, start: row.startChar, end: row.endChar, vector: bytesToVector(row.vector) });
      cursor = page[page.length - 1].id;
      if (page.length < 500) break;
    }
    const [queryVector] = await embedTexts([query]);
    const scored = rows.map((row) => ({ item: row, score: dot(queryVector, row.vector) })).filter((entry) => entry.score > 0.2);
    const bestPerPlace = new Map();
    for (const entry of scored) {
      const place = entry.item.kind === "page" ? `p:${entry.item.documentId}:${entry.item.pdfPage ?? entry.item.refId}` : `a:${entry.item.refId}`;
      const current = bestPerPlace.get(place);
      if (!current || entry.score > current.score) bestPerPlace.set(place, entry);
    }
    return topK(Array.from(bestPerPlace.values()), limit * 2).map(({ item, score }) => ({ documentId: item.documentId, refId: item.refId, pdfPage: item.pdfPage, start: item.start, score }));
  }
  const key = (hit) => `${hit.documentId}:${hit.refId}:${hit.start}`;
  // Same results: same scores position by position (float32 vs float64 arithmetic: 1e-5), and the same
  // passages except where scores tie (tied passages may swap order or across the cut-off).
  function assertSameResults(actual, expected, label) {
    assert.equal(actual.length, expected.length, `${label}: same number of results`);
    for (let i = 0; i < expected.length; i += 1) assert.ok(Math.abs(actual[i].score - expected[i].score) < 1e-5, `${label}: score ${i} ${actual[i].score} vs ${expected[i].score}`);
    const cut = expected.length ? expected[expected.length - 1].score + 1e-5 : 0;
    const strictly = (list) => list.filter((hit) => hit.score > cut).map(key).sort();
    assert.deepEqual(strictly(actual), strictly(expected), `${label}: same passages above the last tie`);
    const tied = (list, score) => list.filter((hit) => Math.abs(hit.score - score) < 1e-5).length;
    for (let i = 0; i < expected.length; i += 1) if (key(actual[i]) !== key(expected[i])) assert.ok(tied(expected, expected[i].score) > 1, `${label}: position ${i} differs only within a tie`);
  }

  const queries = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? meaningPages[i * 97].split(" ").slice(0, 25).join(" ") : words(8 + i)));
  let recallSum = 0;
  const timings = { memory: [], exact: [], index: [] };
  for (const [i, query] of queries.entries()) {
    const scope = i % 2 ? [meaningBook] : null;
    const limit = [10, 30, 50][i % 3];
    const memory = await timed(() => inMemorySearch(query, scope, limit), 1);
    const exact = await timed(() => searchByMeaning(query, scope, limit, { strategy: "exact" }), 3);
    const index = await timed(() => searchByMeaning(query, scope, limit, { strategy: "index" }), 3);
    timings.memory.push(memory.ms); timings.exact.push(exact.ms); timings.index.push(index.ms);
    assert.ok(memory.result.length > 0, "the fixture query has results");
    assertSameResults(exact.result.hits, memory.result, `query ${i} (exact)`);
    const auto = await searchByMeaning(query, scope, limit);
    assertSameResults(auto.hits, memory.result, `query ${i} (auto)`);
    assert.ok(auto.indexedDocuments.has(meaningBook));
    // Recall, counting a tie as found: the fake embedder gives many passages identical scores, and
    // which of the tied ones make the cut is arbitrary in both methods.
    const foundScores = new Map();
    for (const hit of index.result.hits) foundScores.set(hit.score.toFixed(5), (foundScores.get(hit.score.toFixed(5)) ?? 0) + 1);
    let matched = 0;
    for (const hit of memory.result) {
      const left = foundScores.get(hit.score.toFixed(5)) ?? 0;
      if (left > 0) { matched += 1; foundScores.set(hit.score.toFixed(5), left - 1); }
    }
    recallSum += matched / memory.result.length;
    for (const hit of index.result.hits) assert.ok(hit.score > 0.2);
  }
  const recall = recallSum / queries.length;
  assert.ok(recall >= 0.9, `HNSW recall ${recall}`);
  console.log(`meaning search on ${passages} passages, ${queries.length} queries: database (exact) = in-memory results; HNSW recall ${(recall * 100).toFixed(1)}%; median ms in-memory ${median(timings.memory).toFixed(1)}, database exact ${median(timings.exact).toFixed(1)}, HNSW ${median(timings.index).toFixed(1)} (pgvector ${pgvector})`);

  const [queryVector] = await embedTexts([queries[1]]);
  const nearest = nearestPassagesQuery(meaningScope(model, null), Prisma.sql`${vectorLiteral(queryVector)}::vector`, 200);
  const hnswPlan = await explain(nearest, ["SET LOCAL hnsw.ef_search = 200"]);
  assert.ok(planNodes(hnswPlan.Plan).some((node) => node["Index Name"] === "PassageEmbedding_embedding_hnsw_idx"), `nearest-passage query uses the HNSW index:\n${JSON.stringify(hnswPlan.Plan, null, 1).slice(0, 2000)}`);
  console.log(`HNSW plan: ${planNodes(hnswPlan.Plan).map((node) => node["Node Type"] + (node["Index Name"] ? `(${node["Index Name"]})` : "")).join(" > ")}, ${hnswPlan["Execution Time"].toFixed(1)} ms`);

  // --- 4. rows without the vector column (an older app version wrote them) and unreadable rows
  const lateText = "zzlate qqlegacy vvbytes onlyrow";
  const [lateVector] = await embedTexts([lateText]);
  const late = await prisma.passageEmbedding.create({ data: { documentId: meaningBook, kind: "page", refId: "late-row", pdfPage: 99999, startChar: 0, endChar: 5, textHash: "late", model, vector: new Uint8Array(vectorToBytes(lateVector)) } });
  const broken = await prisma.passageEmbedding.create({ data: { documentId: meaningBook, kind: "page", refId: "broken-row", pdfPage: 99998, startChar: 0, endChar: 5, textHash: "broken", model, vector: new Uint8Array([1, 2, 3]) } });
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  const lateSearch = await searchByMeaning(lateText, [meaningBook], 5);
  console.warn = warn;
  assert.equal(lateSearch.hits[0]?.refId, "late-row", "a row stored as bytes only is filled and found");
  assert.ok(warnings.some((message) => /could not be read/.test(message)), "an unreadable row is reported");
  const [stored] = await prisma.$queryRaw`SELECT embedding IS NOT NULL AS filled FROM "PassageEmbedding" WHERE id = ${late.id}`;
  assert.equal(stored.filled, true);
  assert.deepEqual(await fillMissingVectors(model), { filled: 0, unreadable: 1 });
  await prisma.passageEmbedding.delete({ where: { id: broken.id } });
  assert.deepEqual(await fillMissingVectors(model), { filled: 0, unreadable: 0 });
  console.log("rows without a vector column: filled on first search; unreadable rows skipped with a warning");

  console.log("Search indexes verified: trigram exact search, bit-exact backfill, database meaning search = in-memory results, HNSW, lazy fill.");
} finally {
  if (created.length && process.env.KEEP_FIXTURE !== "1") await prisma.document.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
}
