import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { allHighlightColors } from "../../../../lib/highlights";
import type { MilestoneOneAnchorInput, MilestoneOneAnnotationInput } from "../../../../lib/milestone-one-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidInput(value: unknown): value is MilestoneOneAnnotationInput {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Partial<MilestoneOneAnnotationInput>;
  return Boolean(input.documentId && input.versionId && input.sourceId && input.colorKey && (input.selectedText?.trim() || input.note?.trim()) && input.citationStyle && input.citationText);
}

function cleanTags(tags: string[] | undefined) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/^#/, "").slice(0, 60);
    if (tag && !seen.has(tag.toLowerCase())) { seen.add(tag.toLowerCase()); result.push(tag); }
  }
  return result.slice(0, 50);
}

function anchorJsonFor(anchor: MilestoneOneAnchorInput | undefined): Prisma.InputJsonObject | undefined {
  if (!anchor) return undefined;

  return JSON.parse(JSON.stringify({
    selectedText: anchor.selectedText,
    pageNumber: anchor.pageNumber,
    beforeContext: anchor.beforeContext ?? "",
    afterContext: anchor.afterContext ?? "",
    rects: anchor.rects ?? [],
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    lineStart: anchor.lineStart,
    lineEnd: anchor.lineEnd,
    locatorKind: anchor.locatorKind
  })) as Prisma.InputJsonObject;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as unknown;

  if (!isValidInput(body)) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const tagValues = cleanTags(body.tags);
  const anchorJson = anchorJsonFor(body.anchor);
  const clientId = typeof body.clientId === "string" && body.clientId.trim() ? body.clientId.trim().slice(0, 191) : null;

  // A retried save (the first reply never arrived) carries the same browser id: answer with the highlight that
  // already exists instead of creating a duplicate.
  const existing = async () => {
    if (!clientId) return null;
    const found = await prisma.annotation.findUnique({ where: { clientId }, include: { tags: true, citations: { take: 1, orderBy: { createdAt: "asc" } } } });
    if (!found) return null;
    const { citations, ...annotation } = found;
    return { annotation, citation: citations[0] ?? null };
  };
  const already = await existing();
  if (already) return NextResponse.json({ ...already, alreadySaved: true }, { status: 200 });

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    const annotation = await tx.annotation.create({
      data: {
        clientId,
        documentId: body.documentId,
        versionId: body.versionId,
        pageMapId: body.pageMapId ?? null,
        colorKey: body.colorKey,
        selectedText: body.selectedText,
        note: body.note ?? null,
        anchor: anchorJson,
        tags: tagValues.length ? { create: tagValues.map((value) => ({ value })) } : undefined
      },
      include: { tags: true }
    });

    const source = await tx.source.findUniqueOrThrow({ where: { id: body.sourceId } });

    const citation = await tx.citation.create({
      data: {
        sourceId: body.sourceId,
        annotationId: annotation.id,
        styleId: body.citationStyle,
        locatorType: body.locatorType ?? "page",
        locatorValue: body.locatorValue ?? null,
        generatedText: body.citationText,
        sourceSnapshotUpdatedAt: source.updatedAt
      }
    });

    return { annotation, citation };
  });
  } catch (error) {
    // Two copies of the same save arriving at once: the second loses the race on the unique browser id.
    if ((error as { code?: string }).code === "P2002") {
      const raced = await existing();
      if (raced) return NextResponse.json({ ...raced, alreadySaved: true }, { status: 200 });
    }
    console.error("[annotations] could not save a highlight:", error);
    return NextResponse.json({ error: "The highlight could not be saved in the database." }, { status: 500 });
  }

  return NextResponse.json(result, { status: 201 });
}

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// Edit a saved annotation's note and highlight colour. The selected passage,
// anchor, and generated citation are deliberately not editable here: they
// describe what was actually highlighted and cited.
export async function PATCH(request: NextRequest) {
  let body: { annotationId?: unknown; note?: unknown; colorKey?: unknown; tags?: unknown; locatorValue?: unknown; citationText?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return failure("A JSON request body is required.", 400);
  }

  const annotationId = typeof body.annotationId === "string" ? body.annotationId.trim() : "";
  if (!annotationId) return failure("annotationId is required.", 400);
  if (body.note !== undefined && typeof body.note !== "string") return failure("note must be text.", 400);
  if (body.colorKey !== undefined && (typeof body.colorKey !== "string" || !allHighlightColors.some((color) => color.key === body.colorKey))) {
    return failure("colorKey is not a known highlight colour.", 400);
  }

  const existing = await prisma.annotation.findUnique({ where: { id: annotationId }, select: { id: true, selectedText: true } });
  if (!existing) return failure("No annotation found for that id.", 404);

  const note = typeof body.note === "string" ? body.note.trim() : undefined;
  if (note === "" && !existing.selectedText.trim()) return failure("A page note cannot be emptied; delete the record instead.", 400);

  const locatorValue = typeof body.locatorValue === "string" ? body.locatorValue.trim().slice(0, 255) : undefined;
  const citationText = typeof body.citationText === "string" ? body.citationText.trim() : undefined;
  if ((locatorValue === undefined) !== (citationText === undefined)) return failure("locatorValue and citationText must be sent together.", 400);

  const tags = Array.isArray(body.tags) ? cleanTags(body.tags.filter((tag): tag is string => typeof tag === "string")) : undefined;
  const annotation = await prisma.$transaction(async (tx) => {
    const updated = await tx.annotation.update({
      where: { id: annotationId },
      data: { note: note === undefined ? undefined : note || null, colorKey: typeof body.colorKey === "string" ? body.colorKey : undefined }
    });
    if (citationText !== undefined && locatorValue !== undefined) {
      // The page number changed (corrected numbering): keep the citation in step.
      await tx.citation.updateMany({ where: { annotationId }, data: { locatorValue: locatorValue || null, generatedText: citationText } });
    }
    if (tags) {
      await tx.annotationTag.deleteMany({ where: { annotationId } });
      if (tags.length) await tx.annotationTag.createMany({ data: tags.map((value) => ({ annotationId, value })) });
    }
    return updated;
  });
  return NextResponse.json({ annotation, tags: tags ?? undefined });
}

// Delete an annotation together with the citation(s) generated for it.
export async function DELETE(request: NextRequest) {
  const annotationId = request.nextUrl.searchParams.get("annotationId")?.trim();
  if (!annotationId) return failure("annotationId is required.", 400);

  const existing = await prisma.annotation.findUnique({ where: { id: annotationId }, select: { id: true } });
  if (!existing) return failure("No annotation found for that id.", 404);

  await prisma.$transaction([
    prisma.citation.deleteMany({ where: { annotationId } }),
    prisma.annotation.delete({ where: { id: annotationId } })
  ]);
  return NextResponse.json({ deleted: true, annotationId });
}
