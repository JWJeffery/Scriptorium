import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { formatCitation, isCitationStyleId, type CslItem } from "../../../../lib/citation-styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Walk the supersession chain forward from a citation to the current tip.
 * Regeneration always targets the latest version, so requesting
 * regeneration on an old citation id doesn't fork a parallel branch.
 */
async function latestInChain(citationId: string) {
  let current = await prisma.citation.findUniqueOrThrow({ where: { id: citationId } });
  // supersededBy is a 1:1 back-relation; follow it until nothing supersedes current.
  for (;;) {
    const next = await prisma.citation.findUnique({ where: { supersedesCitationId: current.id } });
    if (!next) return current;
    current = next;
  }
}

function isStale(citation: { sourceSnapshotUpdatedAt: Date }, source: { updatedAt: Date }) {
  return citation.sourceSnapshotUpdatedAt.getTime() < source.updatedAt.getTime();
}

export async function GET(request: NextRequest) {
  const documentId = clean(request.nextUrl.searchParams.get("documentId"));
  const sourceId = clean(request.nextUrl.searchParams.get("sourceId"));

  if (!documentId && !sourceId) {
    return NextResponse.json({ error: "documentId or sourceId is required." }, { status: 400 });
  }

  const citations = await prisma.citation.findMany({
    where: {
      // Only chain tips are "live" citations from the user's point of view;
      // superseded rows are history, not something to flag as stale again.
      supersededBy: { is: null },
      source: {
        id: sourceId || undefined,
        documentId: documentId || undefined
      }
    },
    include: { source: true, annotation: { include: { pageMap: true } } }
  });

  const results = citations.map((citation) => ({
    citationId: citation.id,
    sourceId: citation.sourceId,
    annotationId: citation.annotationId,
    styleId: citation.styleId,
    stale: isStale(citation, citation.source),
    generatedText: citation.generatedText,
    sourceUpdatedAt: citation.source.updatedAt,
    citationSnapshotAt: citation.sourceSnapshotUpdatedAt
  }));

  return NextResponse.json({
    documentId: documentId || undefined,
    sourceId: sourceId || undefined,
    count: results.length,
    staleCount: results.filter((r) => r.stale).length,
    results
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { citationId?: string; force?: boolean };
  const citationId = clean(body.citationId);

  if (!citationId) {
    return NextResponse.json({ error: "citationId is required." }, { status: 400 });
  }

  const current = await latestInChain(citationId);
  const source = await prisma.source.findUniqueOrThrow({ where: { id: current.sourceId } });

  if (!isStale(current, source) && !body.force) {
    return NextResponse.json({
      regenerated: false,
      reason: "Citation is not stale relative to its source. Pass force: true to regenerate anyway.",
      citation: current
    });
  }

  if (!isCitationStyleId(current.styleId)) {
    return NextResponse.json(
      { error: `Citation style "${current.styleId}" is not supported by the regeneration formatter yet.` },
      { status: 422 }
    );
  }

  const cslItem = source.cslJson as CslItem;
  const generatedText = formatCitation(cslItem, current.styleId, {
    type: current.locatorType,
    value: current.locatorValue ?? undefined
  });

  const regenerated = await prisma.citation.create({
    data: {
      sourceId: current.sourceId,
      annotationId: current.annotationId,
      styleId: current.styleId,
      locale: current.locale,
      locatorType: current.locatorType,
      locatorValue: current.locatorValue,
      generatedText,
      sourceSnapshotUpdatedAt: source.updatedAt,
      supersedesCitationId: current.id
    }
  });

  return NextResponse.json({ regenerated: true, previous: current, citation: regenerated }, { status: 201 });
}
