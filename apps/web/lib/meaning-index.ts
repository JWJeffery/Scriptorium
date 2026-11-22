import { randomUUID } from "node:crypto";
import { Prisma, type ProcessingJob } from "@prisma/client";
import { latestJobsFor } from "./jobs/jobs.ts";
import { prisma } from "./prisma.ts";
import { activeModelName, embedTexts } from "./embeddings.ts";
import { chunkText, textHash, vectorToBytes } from "./embedding-math.ts";

// Builds and searches the by-meaning index: one vector per passage of a book's text
// and one per saved note. Everything here is rebuildable from the book and the notes.
//
// Each vector is stored twice in "PassageEmbedding": as raw Float32Array bytes ("vector", the lossless
// original) and as a pgvector column ("embedding", zero-padded to 384 numbers) that the database
// searches with an HNSW index. See prisma/migrations/20261122010000_search_indexes.

export type IndexProgress = { documentId: string; done: number; total: number; state: "running" | "finished" | "failed"; error?: string };

/** Width of the pgvector column. Shorter vectors (the 64-number test embedder) are zero-padded. */
export const VECTOR_DIMENSIONS = 384;
/** Passages scoring at or below this are not "related"; unchanged from the in-memory search. */
const MIN_SCORE = 0.2;
/**
 * Up to this many passages in scope, search compares the query with every one of them inside the
 * database: exact (the same results as the former in-memory search) and still quick (measured: 3 ms
 * to score 4,300 passages, 13 ms including grouping when nearly all of them pass the score floor).
 * Above it, the HNSW index finds the nearest passages without reading them all: a few milliseconds
 * at any size, approximate (about 95% of the exact top results in scripts/verify-search-indexes.mjs).
 */
export const EXACT_SEARCH_MAX_PASSAGES = 10000;
/** pgvector's upper bound for hnsw.ef_search, and so for how many candidates one index scan gives. */
const MAX_INDEX_CANDIDATES = 1000;

/** The pgvector text form of a vector, zero-padded to the column width. */
export function vectorLiteral(vector: Float32Array): string {
  if (vector.length > VECTOR_DIMENSIONS) throw new Error(`A ${vector.length}-number vector does not fit the ${VECTOR_DIMENSIONS}-number index.`);
  const values = Array.from(vector, (value) => (Number.isFinite(value) ? value : 0));
  while (values.length < VECTOR_DIMENSIONS) values.push(0);
  return `[${values.join(",")}]`;
}

type SpanRow = { id: string; text: string; pdfPage: bigint | number | null };

async function spansOf(documentId: string): Promise<SpanRow[]> {
  return prisma.$queryRaw<SpanRow[]>(Prisma.sql`
    SELECT ts.id, ts.text, (ts.anchor->>'pdfPageIndex')::int AS "pdfPage"
    FROM "TextSpan" ts JOIN "DocumentVersion" v ON v.id = ts."versionId"
    WHERE v."documentId" = ${documentId}
      AND v.id = (SELECT v2.id FROM "DocumentVersion" v2 WHERE v2."documentId" = v."documentId" ORDER BY v2."createdAt" DESC, v2.id DESC LIMIT 1)
    ORDER BY "pdfPage", ts.id`);
}

const annotationText = (annotation: { selectedText: string; note: string | null; tags: Array<{ value: string }> }) =>
  [annotation.selectedText, annotation.note ?? "", annotation.tags.map((tag) => tag.value).join(" ")].filter((part) => part.trim()).join("\n");

/** Index (or update) one book. Passages that have not changed are not re-read. */
export async function indexDocument(documentId: string, report?: (done: number, total: number) => void) {
  const model = activeModelName();
  const spans = await spansOf(documentId);
  const annotations = await prisma.annotation.findMany({ where: { documentId }, include: { tags: true } });

  type Item = { kind: "page" | "annotation"; refId: string; pdfPage: number | null; start: number; end: number; text: string; hash: string };
  const items: Item[] = [];
  for (const span of spans) {
    for (const chunk of chunkText(span.text)) {
      items.push({ kind: "page", refId: span.id, pdfPage: span.pdfPage === null ? null : Number(span.pdfPage), start: chunk.start, end: chunk.end, text: chunk.text, hash: textHash(chunk.text) });
    }
  }
  for (const annotation of annotations) {
    const text = annotationText(annotation);
    if (text.trim()) items.push({ kind: "annotation", refId: annotation.id, pdfPage: null, start: 0, end: text.length, text, hash: textHash(text) });
  }

  const existing = await prisma.passageEmbedding.findMany({ where: { documentId, model }, select: { id: true, kind: true, refId: true, startChar: true, textHash: true } });
  const have = new Map(existing.map((row) => [`${row.kind}:${row.refId}:${row.startChar}:${row.textHash}`, row.id]));
  const wanted = new Set(items.map((item) => `${item.kind}:${item.refId}:${item.start}:${item.hash}`));
  const stale = existing.filter((row) => !wanted.has(`${row.kind}:${row.refId}:${row.startChar}:${row.textHash}`)).map((row) => row.id);
  const missing = items.filter((item) => !have.has(`${item.kind}:${item.refId}:${item.start}:${item.hash}`));

  report?.(0, missing.length);
  const BATCH = 16;
  for (let i = 0; i < missing.length; i += BATCH) {
    const group = missing.slice(i, i + BATCH);
    const vectors = await embedTexts(group.map((item) => item.text));
    // Prisma cannot write a pgvector column, so the row is inserted with SQL: the bytes and the
    // pgvector column hold the same numbers.
    const rows = group.map((item, index) => Prisma.sql`(${randomUUID()}, ${documentId}, ${item.kind}, ${item.refId}, ${item.pdfPage}, ${item.start}, ${item.end}, ${item.hash}, ${model}, ${vectorToBytes(vectors[index])}, ${vectorLiteral(vectors[index])}::vector)`);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "PassageEmbedding" (id, "documentId", kind, "refId", "pdfPage", "startChar", "endChar", "textHash", model, vector, embedding)
      VALUES ${Prisma.join(rows)}`);
    report?.(Math.min(missing.length, i + group.length), missing.length);
  }
  if (stale.length) await prisma.passageEmbedding.deleteMany({ where: { id: { in: stale } } });
  // Other models' leftovers are useless now.
  await prisma.passageEmbedding.deleteMany({ where: { documentId, NOT: { model } } });
  return { passages: items.length, newlyIndexed: missing.length, removed: stale.length };
}

export async function removeIndex(documentId: string) {
  const removed = await prisma.passageEmbedding.deleteMany({ where: { documentId } });
  return removed.count;
}

function progressOf(documentId: string, job: ProcessingJob | undefined): IndexProgress | null {
  if (!job) return null;
  const state = job.state === "COMPLETE" ? "finished" : job.state === "FAILED" ? "failed" : "running";
  return { documentId, done: job.progressDone, total: job.progressTotal, state, ...(job.error ? { error: job.error } : {}) };
}

/** Every book (no cap: the list is small per book and the counts come from an index). */
export async function indexStatus() {
  const model = activeModelName();
  const counts = await prisma.passageEmbedding.groupBy({ by: ["documentId", "kind"], where: { model }, _count: { _all: true } });
  const countOf = new Map(counts.map((row) => [`${row.documentId}:${row.kind}`, row._count._all]));
  const documents = await prisma.document.findMany({ where: { deletedAt: null }, select: { id: true, title: true, kind: true, versions: { orderBy: { createdAt: "desc" }, take: 1, select: { _count: { select: { textSpans: true } } } } }, orderBy: { updatedAt: "desc" } });
  const jobs = new Map<string, ProcessingJob>();
  // Bounded IN lists, however large the library.
  for (let i = 0; i < documents.length; i += 1000) {
    for (const [id, job] of await latestJobsFor("embed-index", documents.slice(i, i + 1000).map((document) => document.id))) jobs.set(id, job);
  }
  return documents.map((document) => ({
    documentId: document.id,
    title: document.title,
    kind: document.kind,
    pages: document.versions[0]?._count.textSpans ?? 0,
    pagePassages: countOf.get(`${document.id}:page`) ?? 0,
    notePassages: countOf.get(`${document.id}:annotation`) ?? 0,
    progress: progressOf(document.id, jobs.get(document.id))
  }));
}

// --- searching

/**
 * Rows whose pgvector column is still empty (written by an app version from before the column
 * existed, e.g. a worker that had not been restarted yet) are filled from their bytes, with the same
 * SQL function the migration used. Rows that cannot be decoded stay empty, are skipped by search, and
 * are reported in the log; rebuilding that book's index replaces them.
 */
export async function fillMissingVectors(model = activeModelName()) {
  const [pending] = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS (SELECT 1 FROM "PassageEmbedding" WHERE model = ${model} AND embedding IS NULL) AS exists`);
  if (!pending?.exists) return { filled: 0, unreadable: 0 };
  const filled = await prisma.$executeRaw(Prisma.sql`
    UPDATE "PassageEmbedding" SET embedding = scriptorium_bytes_to_vector(vector)
    WHERE model = ${model} AND embedding IS NULL AND scriptorium_bytes_to_vector(vector) IS NOT NULL`);
  const [left] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*) AS count FROM "PassageEmbedding" WHERE model = ${model} AND embedding IS NULL`);
  const unreadable = Number(left?.count ?? 0);
  if (unreadable > 0) console.warn(`[meaning-index] ${unreadable} stored passage vector(s) for ${model} could not be read and are left out of search; rebuild those books' indexes to replace them.`);
  return { filled, unreadable };
}

let pgvectorVersion: Promise<number[]> | null = null;
/** The installed pgvector version, e.g. [0, 8, 0]; iterative index scans need 0.8. */
function vectorExtensionVersion() {
  pgvectorVersion ??= prisma
    .$queryRaw<Array<{ extversion: string }>>(Prisma.sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`)
    .then((rows) => (rows[0]?.extversion ?? "0").split(".").map((part) => Number.parseInt(part, 10) || 0))
    .catch((error) => { pgvectorVersion = null; throw error; });
  return pgvectorVersion;
}

export type MeaningHit = { kind: "page" | "annotation"; documentId: string; refId: string; pdfPage: number | null; start: number; end: number; score: number };
type Candidate = { id: string; documentId: string; kind: string; refId: string; pdfPage: number | null; startChar: number; endChar: number; score: number };

const toHit = (row: Candidate): MeaningHit => ({ kind: row.kind as "page" | "annotation", documentId: row.documentId, refId: row.refId, pdfPage: row.pdfPage, start: row.startChar, end: row.endChar, score: Number(row.score) });

// One passage per page (several passages can come from one long page) and one per note.
const placeOf = (row: { kind: string; documentId: string; pdfPage: number | null; refId: string }) =>
  row.kind === "page" ? `p:${row.documentId}:${row.pdfPage ?? row.refId}` : `a:${row.refId}`;
const placeSql = Prisma.sql`CASE WHEN pe.kind = 'page' THEN 'p:' || pe."documentId" || ':' || COALESCE(pe."pdfPage"::text, pe."refId") ELSE 'a:' || pe."refId" END`;

/** The passages search may return: the active model, books not in the bin, optionally some books. */
export function meaningScope(model: string, documentIds: string[] | null) {
  return Prisma.sql`pe.model = ${model}
    AND pe."documentId" NOT IN (SELECT d.id FROM "Document" d WHERE d."deletedAt" IS NOT NULL)
    ${documentIds ? Prisma.sql`AND pe."documentId" IN (${Prisma.join(documentIds)})` : Prisma.empty}`;
}

/** Nearest passages by the HNSW index (ORDER BY the distance operator itself, so the index is usable). */
export function nearestPassagesQuery(scope: Prisma.Sql, target: Prisma.Sql, candidates: number) {
  return Prisma.sql`
    SELECT pe.id, pe."documentId", pe.kind, pe."refId", pe."pdfPage", pe."startChar", pe."endChar",
           (pe.embedding <#> ${target}) * -1 AS score
    FROM "PassageEmbedding" pe
    WHERE ${scope} AND pe.embedding IS NOT NULL
    ORDER BY pe.embedding <#> ${target}
    LIMIT ${candidates}`;
}

/** Passages and notes closest in meaning to the query, best first. At most one passage per page. */
export async function searchByMeaning(
  query: string,
  documentIds: string[] | null,
  limit: number,
  options: { strategy?: "auto" | "exact" | "index" } = {}
): Promise<{ hits: MeaningHit[]; indexedDocuments: Set<string> }> {
  const model = activeModelName();
  if (documentIds && documentIds.length === 0) return { hits: [], indexedDocuments: new Set() };
  await fillMissingVectors(model);

  const scope = meaningScope(model, documentIds);
  // Which books have an index (read from the (model, documentId) index, not the vectors).
  const perDocument = await prisma.$queryRaw<Array<{ documentId: string; passages: bigint }>>(Prisma.sql`
    SELECT pe."documentId", count(*) AS passages FROM "PassageEmbedding" pe WHERE ${scope} GROUP BY pe."documentId"`);
  const indexedDocuments = new Set(perDocument.map((row) => row.documentId));
  const total = perDocument.reduce((sum, row) => sum + Number(row.passages), 0);
  if (total === 0) return { hits: [], indexedDocuments };

  const [queryVector] = await embedTexts([query]);
  const target = Prisma.sql`${vectorLiteral(queryVector)}::vector`;
  const wanted = limit * 2;
  const strategy = options.strategy && options.strategy !== "auto" ? options.strategy : total <= EXACT_SEARCH_MAX_PASSAGES ? "exact" : "index";

  if (strategy === "exact") {
    // Every passage in scope is scored inside the database. Same rules as the former in-memory
    // search: score = dot product, keep > 0.2, best passage per place (earliest id on a tie), places
    // ordered by score and then by the earliest id seen for that place.
    const rows = await prisma.$queryRaw<Candidate[]>(Prisma.sql`
      WITH scored AS MATERIALIZED (
        SELECT pe.id, pe."documentId", pe.kind, pe."refId", pe."pdfPage", pe."startChar", pe."endChar",
               (pe.embedding <#> ${target}) * -1 AS score, ${placeSql} AS place
        FROM "PassageEmbedding" pe
        WHERE ${scope} AND pe.embedding IS NOT NULL
      ), kept AS (
        SELECT *, min(id) OVER (PARTITION BY place) AS "firstId" FROM scored WHERE score > ${MIN_SCORE}
      ), best AS (
        SELECT DISTINCT ON (place) * FROM kept ORDER BY place, score DESC, id
      )
      SELECT id, "documentId", kind, "refId", "pdfPage", "startChar", "endChar", score FROM best
      ORDER BY score DESC, "firstId" LIMIT ${wanted}`);
    return { hits: rows.map(toHit), indexedDocuments };
  }

  // Large scope: the HNSW index hands back the nearest passages in order of distance. One place can
  // own several of them, so ask for more than needed and ask again (up to pgvector's maximum) while the
  // candidates are all still above the score floor and too few distinct places have been found.
  const [major = 0, minor = 0] = await vectorExtensionVersion();
  const iterative = major > 0 || minor >= 8;
  let candidates = Math.min(MAX_INDEX_CANDIDATES, Math.max(40, wanted * 4));
  for (;;) {
    const rows = await prisma.$transaction(async (tx) => {
      // A wider search list than the default 40 (more of the true nearest are found), never below the LIMIT.
      await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${Math.min(MAX_INDEX_CANDIDATES, Math.max(400, candidates * 2))}`);
      // pgvector 0.8+: keep scanning the index when rows are filtered out (other model, deleted book,
      // another book when the search is limited), instead of returning fewer rows than asked for.
      if (iterative) await tx.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = relaxed_order`);
      return tx.$queryRaw<Candidate[]>(nearestPassagesQuery(scope, target, candidates));
    });
    const best = new Map<string, Candidate>();
    for (const row of rows) {
      if (Number(row.score) <= MIN_SCORE) continue;
      const place = placeOf(row);
      const current = best.get(place);
      if (!current || Number(row.score) > Number(current.score) || (Number(row.score) === Number(current.score) && row.id < current.id)) best.set(place, row);
    }
    const lowest = rows.length ? Math.min(...rows.map((row) => Number(row.score))) : 0;
    const exhausted = rows.length < candidates || lowest <= MIN_SCORE || candidates >= MAX_INDEX_CANDIDATES;
    if (best.size >= wanted || exhausted) {
      const hits = Array.from(best.values()).sort((a, b) => Number(b.score) - Number(a.score) || (a.id < b.id ? -1 : 1)).slice(0, wanted).map(toHit);
      return { hits, indexedDocuments };
    }
    candidates = Math.min(MAX_INDEX_CANDIDATES, candidates * 4);
  }
}
