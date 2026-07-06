import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import type { MilestoneOneAnnotationInput } from "../../../../lib/milestone-one-types";

function isValidInput(value: unknown): value is MilestoneOneAnnotationInput {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Partial<MilestoneOneAnnotationInput>;
  return Boolean(
    input.documentId &&
    input.versionId &&
    input.sourceId &&
    input.colorKey &&
    input.selectedText &&
    input.citationStyle &&
    input.citationText
  );
}

function cleanTags(tags: string[] | undefined) {
  return Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))).slice(0, 50);
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as unknown;

  if (!isValidInput(body)) {
    return NextResponse.json({ error: "Invalid annotation payload." }, { status: 400 });
  }

  const tagValues = cleanTags(body.tags);

  const result = await prisma.$transaction(async (tx) => {
    const annotation = await tx.annotation.create({
      data: {
        documentId: body.documentId,
        versionId: body.versionId,
        pageMapId: body.pageMapId ?? null,
        colorKey: body.colorKey,
        selectedText: body.selectedText,
        note: body.note ?? null,
        anchor: body.anchor ?? undefined,
        tags: tagValues.length ? { create: tagValues.map((value) => ({ value })) } : undefined
      },
      include: { tags: true }
    });

    const citation = await tx.citation.create({
      data: {
        sourceId: body.sourceId,
        annotationId: annotation.id,
        styleId: body.citationStyle,
        locatorType: body.locatorType ?? "page",
        locatorValue: body.locatorValue ?? null,
        generatedText: body.citationText
      }
    });

    return { annotation, citation };
  });

  return NextResponse.json(result, { status: 201 });
}
