import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { cosineSimilarity, similaritySnippet } from "../../../../lib/local-similarity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PassageCandidate = {
  kind: "text-span" | "annotation-passage";
  id: string;
  text: string;
  title: string;
  documentId: string;
  sourceId?: string;
  annotationId?: string;
  citationId?: string;
  locator?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedQuery(value: string | null) {
  const query = clean(value).slice(0, 240);
  if (query.length < 3) return "";
  return query;
}

function boundedLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "10", 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(Math.max(parsed, 1), 25);
}

function boundedCandidatePool(value: string | null) {
  const parsed = Number.parseInt(value ?? "200", 10);
  if (!Number.isFinite(parsed)) return 200;
  return Math.min(Math.max(parsed, 20), 300);
}

function documentTitle(document: { title?: string | null; originalFilename?: string | null } | null | undefined) {
  return clean(document?.title) || clean(document?.originalFilename) || "Untitled document";
}

function locator(pageMap: { bookPageLabel?: string | null; visibleLabel?: string | null } | null | undefined, locatorType?: string | null, locatorValue?: string | null) {
  const explicit = [clean(locatorType), clean(locatorValue)].filter(Boolean).join(" ");
  if (explicit) return explicit;
  const page = clean(pageMap?.bookPageLabel) || clean(pageMap?.visibleLabel);
  return page ? `page ${page}` : undefined;
}

export async function GET(request: NextRequest) {
  const query = boundedQuery(request.nextUrl.searchParams.get("q"));
  const limit = boundedLimit(request.nextUrl.searchParams.get("limit"));
  const candidatePool = boundedCandidatePool(request.nextUrl.searchParams.get("candidatePool"));

  if (!query) {
    return NextResponse.json({ error: "q must be at least three characters." }, { status: 400 });
  }

  const [textSpans, annotations] = await Promise.all([
    prisma.textSpan.findMany({
      include: { pageMap: true, version: { include: { document: { include: { sources: true } } } } },
      orderBy: { createdAt: "desc" },
      take: candidatePool
    }),
    prisma.annotation.findMany({
      include: { document: true, pageMap: true, citations: { include: { source: true } } },
      orderBy: { updatedAt: "desc" },
      take: candidatePool
    })
  ]);

  const candidates: PassageCandidate[] = [
    ...textSpans.map((span) => ({
      kind: "text-span" as const,
      id: span.id,
      text: span.text,
      title: documentTitle(span.version.document),
      documentId: span.version.documentId,
      sourceId: span.version.document.sources[0]?.id,
      locator: locator(span.pageMap)
    })),
    ...annotations.map((annotation) => ({
      kind: "annotation-passage" as const,
      id: annotation.id,
      text: `${annotation.selectedText}\n${annotation.note ?? ""}`,
      title: documentTitle(annotation.document),
      documentId: annotation.documentId,
      sourceId: annotation.citations[0]?.sourceId,
      annotationId: annotation.id,
      citationId: annotation.citations[0]?.id,
      locator: locator(annotation.pageMap)
    }))
  ];

  const results = candidates
    .map((candidate) => ({
      ...candidate,
      score: cosineSimilarity(query, candidate.text),
      snippet: similaritySnippet(candidate.text, query)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ text, ...result }) => result);

  await prisma.queryLog.create({
    data: {
      query,
      mode: "semantic-search",
      filters: { limit, candidatePool, scorer: "local-token-cosine-v1" },
      resultIds: results.map((result) => ({ kind: result.kind, id: result.id, score: result.score }))
    }
  });

  return NextResponse.json({
    query,
    mode: "semantic-search",
    scorer: "local-token-cosine-v1",
    limit,
    candidatePool,
    count: results.length,
    results
  });
}
