import { NextResponse } from "next/server";
import { notFound, parseQuery, route, z } from "../../../../../../lib/api-v1";
import { prisma } from "../../../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A book's highlights and notes, newest first, without any of the book's text.
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, context) => {
  const { id } = await context.params;
  const { limit } = parseQuery(request, z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }));
  if (!(await prisma.document.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
  const rows = await prisma.annotation.findMany({
    where: { documentId: id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { tags: true, citations: { select: { locatorValue: true }, take: 1 } }
  });
  return NextResponse.json({
    annotations: rows.map((row) => ({
      id: row.id,
      colorKey: row.colorKey,
      selectedText: row.selectedText.length > 400 ? `${row.selectedText.slice(0, 400)}…` : row.selectedText,
      note: row.note,
      tags: row.tags.map((tag) => tag.value),
      pdfPage: typeof (row.anchor as { pageNumber?: number } | null)?.pageNumber === "number" ? (row.anchor as { pageNumber: number }).pageNumber : null,
      bookPage: row.citations[0]?.locatorValue ?? null,
      createdAt: row.createdAt
    }))
  });
});
