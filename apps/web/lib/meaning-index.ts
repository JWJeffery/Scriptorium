import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.ts";
import { activeModelName, embedTexts } from "./embeddings.ts";
import { bytesToVector, chunkText, dot, textHash, topK, vectorToBytes, type Scored } from "./embedding-math.ts";

// Builds and searches the by-meaning index: one vector per passage of a book's text
// and one per saved note. Everything here is rebuildable from the book and the notes.

export type IndexProgress = { documentId: string; done: number; total: number; state: "running" | "finished" | "failed"; error?: string };
const globalForIndex = globalThis as unknown as { scriptoriumIndexProgress?: Map<string, IndexProgress> };
export const indexProgress = globalForIndex.scriptoriumIndexProgress ?? new Map<string, IndexProgress>();
globalForIndex.scriptoriumIndexProgress = indexProgress;

type SpanRow = { id: string; text: string; pdfPage: bigint | number | null };

async function spansOf(documentId: string): Promise<SpanRow[]> {
  return prisma.$queryRaw<SpanRow[]>(Prisma.sql`
    SELECT ts.id, ts.text, CAST(JSON_UNQUOTE(JSON_EXTRACT(ts.anchor, '$.pdfPageIndex')) AS SIGNED) AS pdfPage
    FROM TextSpan ts JOIN DocumentVersion v ON v.id = ts.versionId
    WHERE v.documentId = ${documentId}
      AND v.id = (SELECT v2.id FROM DocumentVersion v2 WHERE v2.documentId = v.documentId ORDER BY v2.createdAt DESC, v2.id DESC LIMIT 1)
    ORDER BY pdfPage, ts.id`);
}

const annotationText = (annotation: { selectedText: string; note: string | null; tags: Array<{ value: string }> }) =>
  [annotation.selectedText, annotation.note ?? "", annotation.tags.map((tag) => tag.value).join(" ")].filter((part) => part.trim()).join("\n");

/** Index (or update) one book. Passages that have not changed are not re-read. */
export async function indexDocument(documentId: string) {
  const model = activeModelName();
  indexProgress.set(documentId, { documentId, done: 0, total: 0, state: "running" });
  try {
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

    const progress = indexProgress.get(documentId) as IndexProgress;
    progress.total = missing.length;
    const BATCH = 16;
    for (let i = 0; i < missing.length; i += BATCH) {
      const group = missing.slice(i, i + BATCH);
      const vectors = await embedTexts(group.map((item) => item.text));
      await prisma.passageEmbedding.createMany({
        data: group.map((item, index) => ({ documentId, kind: item.kind, refId: item.refId, pdfPage: item.pdfPage, startChar: item.start, endChar: item.end, textHash: item.hash, model, vector: new Uint8Array(vectorToBytes(vectors[index])) }))
      });
      progress.done = Math.min(missing.length, i + group.length);
    }
    if (stale.length) await prisma.passageEmbedding.deleteMany({ where: { id: { in: stale } } });
    // Other models' leftovers are useless now.
    await prisma.passageEmbedding.deleteMany({ where: { documentId, NOT: { model } } });
    progress.state = "finished";
    invalidateCache();
    return { passages: items.length, newlyIndexed: missing.length, removed: stale.length };
  } catch (error) {
    indexProgress.set(documentId, { documentId, done: 0, total: 0, state: "failed", error: error instanceof Error ? error.message : "Indexing failed." });
    throw error;
  }
}

export async function removeIndex(documentId: string) {
  const removed = await prisma.passageEmbedding.deleteMany({ where: { documentId } });
  indexProgress.delete(documentId);
  invalidateCache();
  return removed.count;
}

export async function indexStatus() {
  const model = activeModelName();
  const counts = await prisma.passageEmbedding.groupBy({ by: ["documentId", "kind"], where: { model }, _count: { _all: true } });
  const documents = await prisma.document.findMany({ select: { id: true, title: true, kind: true, versions: { orderBy: { createdAt: "desc" }, take: 1, select: { _count: { select: { textSpans: true } } } } }, orderBy: { updatedAt: "desc" }, take: 300 });
  return documents.map((document) => {
    const pagePassages = counts.find((row) => row.documentId === document.id && row.kind === "page")?._count._all ?? 0;
    const notePassages = counts.find((row) => row.documentId === document.id && row.kind === "annotation")?._count._all ?? 0;
    return { documentId: document.id, title: document.title, kind: document.kind, pages: document.versions[0]?._count.textSpans ?? 0, pagePassages, notePassages, progress: indexProgress.get(document.id) ?? null };
  });
}

// --- searching

type Loaded = { documentId: string; kind: string; refId: string; pdfPage: number | null; start: number; end: number; vector: Float32Array };
let cache: { key: string; rows: Loaded[] } | null = null;
export function invalidateCache() { cache = null; }

async function loadVectors(documentIds: string[] | null): Promise<Loaded[]> {
  const model = activeModelName();
  const key = `${model}|${documentIds ? [...documentIds].sort().join(",") : "*"}`;
  if (cache?.key === key) return cache.rows;
  const rows: Loaded[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.passageEmbedding.findMany({
      where: { model, ...(documentIds ? { documentId: { in: documentIds } } : {}) },
      orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    });
    if (page.length === 0) break;
    for (const row of page) rows.push({ documentId: row.documentId, kind: row.kind, refId: row.refId, pdfPage: row.pdfPage, start: row.startChar, end: row.endChar, vector: bytesToVector(row.vector) });
    cursor = page[page.length - 1].id;
    if (page.length < 500) break;
  }
  cache = { key, rows };
  return rows;
}

export type MeaningHit = { kind: "page" | "annotation"; documentId: string; refId: string; pdfPage: number | null; start: number; end: number; score: number };

/** Passages and notes closest in meaning to the query, best first. At most one passage per page. */
export async function searchByMeaning(query: string, documentIds: string[] | null, limit: number): Promise<{ hits: MeaningHit[]; indexedDocuments: Set<string> }> {
  const rows = await loadVectors(documentIds);
  const indexedDocuments = new Set(rows.map((row) => row.documentId));
  if (rows.length === 0) return { hits: [], indexedDocuments };
  const [queryVector] = await embedTexts([query]);
  const scored: Array<Scored<Loaded>> = rows.map((row) => ({ item: row, score: dot(queryVector, row.vector) })).filter((entry) => entry.score > 0.2);
  const bestPerPlace = new Map<string, Scored<Loaded>>();
  for (const entry of scored) {
    const place = entry.item.kind === "page" ? `p:${entry.item.documentId}:${entry.item.pdfPage ?? entry.item.refId}` : `a:${entry.item.refId}`;
    const current = bestPerPlace.get(place);
    if (!current || entry.score > current.score) bestPerPlace.set(place, entry);
  }
  const best = topK(Array.from(bestPerPlace.values()), limit * 2);
  return { hits: best.map(({ item, score }) => ({ kind: item.kind as "page" | "annotation", documentId: item.documentId, refId: item.refId, pdfPage: item.pdfPage, start: item.start, end: item.end, score })), indexedDocuments };
}
