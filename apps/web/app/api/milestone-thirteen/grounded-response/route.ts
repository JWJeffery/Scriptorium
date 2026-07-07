import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { cosineSimilarity, similaritySnippet } from "../../../../lib/local-similarity";
import { buildGroundedResponse, type GroundedEvidence } from "../../../../lib/grounded-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedQuery(value: string | null) {
  const query = clean(value).slice(0, 240);
  if (query.length < 3) return "";
  return query;
}

function boundedLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "5", 10);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(parsed, 1), 8);
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

  const evidence: GroundedEvidence[] = [
    ...textSpans.map((span) => {
      const score = cosineSimilarity(query, span.text);
      return {
        kind: "text-span" as const,
        id: span.id,
        title: documentTitle(span.version.document),
        snippet: similaritySnippet(span.text, query),
        score,
        documentId: span.version.documentId,
        sourceId: span.version.document.sources[0]?.id,
        locator: locator(span.pageMap)
      };
    }),
    ...annotations.map((annotation) => {
      const text = `${annotation.selectedText}\n${annotation.note ?? ""}`;
      const score = cosineSimilarity(query, text);
      return {
        kind: "annotation-passage" as const,
        id: annotation.id,
        title: documentTitle(annotation.document),
        snippet: similaritySnippet(text, query),
        score,
        documentId: annotation.documentId,
        sourceId: annotation.citations[0]?.sourceId,
        annotationId: annotation.id,
        citationId: annotation.citations[0]?.id,
        locator: locator(annotation.pageMap)
      };
    })
  ]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const grounded = buildGroundedResponse(query, evidence, limit);

  await prisma.queryLog.create({
    data: {
      query,
      mode: "grounded-response",
      filters: { limit, candidatePool, composer: "passage-cited-local-v1" },
      resultIds: grounded.evidence.map((item) => ({ kind: item.kind, id: item.id, score: item.score }))
    }
  });

  return NextResponse.json({
    query,
    mode: "grounded-response",
    composer: "passage-cited-local-v1",
    supported: grounded.supported,
    response: grounded.response,
    points: grounded.points,
    evidence: grounded.evidence,
    unsupported: grounded.unsupported
  });
}
