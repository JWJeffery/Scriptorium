import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { exportResearchThread } from "../../../../lib/thread-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RenderFormat = "markdown" | "rtf";
const itemOrder = { orderIndex: "asc" as const };

function renderFormat(value: string | null): RenderFormat | null {
  return value === "markdown" || value === "rtf" ? value : null;
}

async function loadThread(threadId: string) {
  const thread = await prisma.researchThread.findUnique({
    where: { id: threadId },
    include: { tags: { orderBy: { value: "asc" } }, items: { orderBy: itemOrder } }
  });

  if (!thread) return null;

  const annotationIds = thread.items.filter((item) => item.itemType === "ANNOTATION").map((item) => item.itemId);
  const citationIds = thread.items.filter((item) => item.itemType === "CITATION").map((item) => item.itemId);

  const [annotations, citations] = await Promise.all([
    annotationIds.length ? prisma.annotation.findMany({
      where: { id: { in: annotationIds } },
      include: { document: true, pageMap: true, citations: { include: { source: true } } }
    }) : [],
    citationIds.length ? prisma.citation.findMany({
      where: { id: { in: citationIds } },
      include: { source: true, annotation: { include: { document: true, pageMap: true } } }
    }) : []
  ]);

  const annotationMap = new Map(annotations.map((value) => [value.id, value]));
  const citationMap = new Map(citations.map((value) => [value.id, value]));

  return {
    ...thread,
    items: thread.items.map((item) => ({
      ...item,
      context:
        item.itemType === "ANNOTATION" ? annotationMap.get(item.itemId) ?? null :
        item.itemType === "CITATION" ? citationMap.get(item.itemId) ?? null :
        null
    }))
  };
}

export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get("threadId")?.trim();
  const format = renderFormat(request.nextUrl.searchParams.get("format"));

  if (!threadId) return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  if (!format) return NextResponse.json({ error: "format must be markdown or rtf." }, { status: 400 });

  const thread = await loadThread(threadId);
  if (!thread) return NextResponse.json({ error: "Research thread not found." }, { status: 404 });

  return NextResponse.json({ format, rendered: exportResearchThread(thread, format) });
}
