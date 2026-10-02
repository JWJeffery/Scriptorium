import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { cosineSimilarity } from "../../../lib/local-similarity";
import { escapeLike, lineOfFirstMatch, makeSnippet, matchRank, parseQuery, type Snippet } from "../../../lib/search-text";
import { bookLabel, type NumberingSystem } from "../../../lib/page-labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One search endpoint for the Search panel.
//   mode=exact   every word must appear on the page; phrases rank first
//   mode=related pages and notes ranked by similarity of meaning-bearing words
// Optional documentId limits the search to one document.

type PageRow = { id: string; versionId: string; documentId: string; text: string; pdfPageIndex: bigint | number | null };

const MAX_PAGE_CANDIDATES = 400;
const MAX_RELATED_CANDIDATES = 4000;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "30", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 30;
}

// Latest version of each document only: older versions would repeat every hit.
function pageQuery(whereExtra: Prisma.Sql, limit: number) {
  return Prisma.sql`
    SELECT ts.id, ts.versionId, v.documentId, ts.text,
           CAST(JSON_UNQUOTE(JSON_EXTRACT(ts.anchor, '$.pdfPageIndex')) AS SIGNED) AS pdfPageIndex
    FROM TextSpan ts
    JOIN DocumentVersion v ON v.id = ts.versionId
    WHERE v.id = (SELECT v2.id FROM DocumentVersion v2 WHERE v2.documentId = v.documentId ORDER BY v2.createdAt DESC, v2.id DESC LIMIT 1)
    ${whereExtra}
    ORDER BY v.documentId, pdfPageIndex, ts.id
    LIMIT ${limit}`;
}

export async function GET(request: NextRequest) {
  const raw = clean(request.nextUrl.searchParams.get("q")).slice(0, 200);
  const mode = request.nextUrl.searchParams.get("mode") === "related" ? "related" : "exact";
  const documentId = clean(request.nextUrl.searchParams.get("documentId"));
  const limit = boundedLimit(request.nextUrl.searchParams.get("limit"));
  const terms = parseQuery(raw);

  if (raw.length < 2 || terms.length === 0) {
    return NextResponse.json({ error: "Type at least two characters to search." }, { status: 400 });
  }

  const scope = documentId ? Prisma.sql`AND v.documentId = ${documentId}` : Prisma.empty;

  let pageRows: PageRow[];
  if (mode === "exact") {
    const likes = terms.map((term) => Prisma.sql`AND ts.text LIKE ${`%${escapeLike(term)}%`}`);
    // Words broken across lines are rare enough that a LIKE on the raw column
    // is a safe pre-filter; exact phrase ranking happens on cleaned text below.
    pageRows = await prisma.$queryRaw<PageRow[]>(pageQuery(Prisma.sql`${scope} ${Prisma.join(likes, " ")}`, MAX_PAGE_CANDIDATES));
  } else {
    pageRows = await prisma.$queryRaw<PageRow[]>(pageQuery(scope, MAX_RELATED_CANDIDATES));
  }

  const documentIds = Array.from(new Set(pageRows.map((row) => row.documentId)));
  const documents = documentIds.length
    ? await prisma.document.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, title: true, kind: true, versions: { orderBy: { createdAt: "desc" }, take: 1, select: { pages: { orderBy: { pdfPageIndex: "asc" }, take: 1, select: { note: true } } } } }
      })
    : [];
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const versionIds = Array.from(new Set(pageRows.map((row) => row.versionId)));
  const rangeRows = versionIds.length ? await prisma.pageRange.findMany({ where: { versionId: { in: versionIds } }, orderBy: { startPdfPage: "asc" } }) : [];
  const rangesByVersion = new Map<string, Array<{ startPdfPage: number; endPdfPage: number | null; system: NumberingSystem; startValue: number; prefix: string }>>();
  for (const row of rangeRows) {
    const list = rangesByVersion.get(row.versionId) ?? [];
    list.push({ startPdfPage: row.startPdfPage, endPdfPage: row.endPdfPage, system: row.system as NumberingSystem, startValue: row.startValue, prefix: row.prefix });
    rangesByVersion.set(row.versionId, list);
  }

  type PageHit = {
    kind: "page";
    documentId: string;
    documentTitle: string;
    versionId: string;
    pdfPageIndex: number | null;
    bookPage: string | null;
    line: number | null;
    snippet: Snippet;
    score: number;
  };

  const pageHits: PageHit[] = [];
  for (const row of pageRows) {
    const rank = mode === "exact" ? matchRank(row.text, terms) : 1;
    const score = mode === "exact" ? rank : cosineSimilarity(raw, row.text);
    if (mode === "exact" ? rank === 0 : score <= 0) continue;
    const document = documentById.get(row.documentId);
    const pdfPageIndex = row.pdfPageIndex === null ? null : Number(row.pdfPageIndex);
    const note = document?.versions[0]?.pages[0]?.note ?? null;
    pageHits.push({
      kind: "page",
      documentId: row.documentId,
      documentTitle: document?.title ?? "Untitled document",
      versionId: row.versionId,
      pdfPageIndex,
      bookPage: pdfPageIndex === null ? null : bookLabel(rangesByVersion.get(row.versionId), note, pdfPageIndex),
      line: pdfPageIndex === null ? lineOfFirstMatch(row.text, terms) : null,
      snippet: makeSnippet(row.text, terms),
      score
    });
  }
  pageHits.sort((a, b) => b.score - a.score || a.documentTitle.localeCompare(b.documentTitle) || (a.pdfPageIndex ?? 0) - (b.pdfPageIndex ?? 0));

  // Notes, highlights, and tags.
  const termFilters = terms.map((term) => ({
    OR: [{ selectedText: { contains: term } }, { note: { contains: term } }, { tags: { some: { value: { contains: term } } } }]
  }));
  const annotationRows = await prisma.annotation.findMany({
    where: mode === "exact" ? { AND: termFilters, ...(documentId ? { documentId } : {}) } : { ...(documentId ? { documentId } : {}) },
    include: { document: { select: { title: true } }, tags: true, citations: { select: { locatorValue: true }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: mode === "exact" ? 200 : 1000
  });

  const annotationHits = annotationRows
    .map((annotation) => {
      const combined = `${annotation.selectedText}\n${annotation.note ?? ""}\n${annotation.tags.map((tag) => tag.value).join(" ")}`;
      const rank = mode === "exact" ? matchRank(combined, terms) : 1;
      const score = mode === "exact" ? rank : cosineSimilarity(raw, combined);
      const anchor = annotation.anchor as { pageNumber?: number } | null;
      return {
        kind: "annotation" as const,
        annotationId: annotation.id,
        documentId: annotation.documentId,
        documentTitle: annotation.document.title,
        versionId: annotation.versionId,
        pdfPageIndex: typeof anchor?.pageNumber === "number" ? anchor.pageNumber : null,
        bookPage: annotation.citations[0]?.locatorValue ?? null,
        colorKey: annotation.colorKey,
        tags: annotation.tags.map((tag) => tag.value),
        note: annotation.note ?? "",
        selectedText: annotation.selectedText,
        snippet: makeSnippet(combined, terms),
        score,
        include: mode === "exact" ? rank > 0 : score > 0
      };
    })
    .filter((hit) => hit.include)
    .sort((a, b) => b.score - a.score)
    .map(({ include, ...hit }) => {
      void include;
      return hit;
    });

  const threadRows = mode === "exact"
    ? await prisma.researchThread.findMany({
        where: { AND: terms.map((term) => ({ OR: [{ title: { contains: term } }, { description: { contains: term } }, { tags: { some: { value: { contains: term } } } }] })) },
        select: { id: true, title: true, _count: { select: { items: true } } },
        take: 20,
        orderBy: { updatedAt: "desc" }
      })
    : [];

  await prisma.queryLog.create({
    data: { query: raw, mode: `search-${mode}`, filters: { documentId: documentId || null, limit }, resultIds: { pages: pageHits.length, annotations: annotationHits.length } }
  });

  return NextResponse.json({
    query: raw,
    mode,
    scope: documentId ? "document" : "all",
    counts: { pages: pageHits.length, annotations: annotationHits.length, threads: threadRows.length },
    pages: pageHits.slice(0, limit),
    annotations: annotationHits.slice(0, limit),
    threads: threadRows.map((thread) => ({ threadId: thread.id, title: thread.title, itemCount: thread._count.items })),
    truncated: pageHits.length > limit || annotationHits.length > limit
  });
}
