import { NextRequest, NextResponse } from "next/server";
import type { ResearchThreadItemType } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ThreadItemInput = {
  itemType?: ResearchThreadItemType;
  itemId?: string;
  note?: string;
  orderIndex?: number;
};

type ThreadPayload = {
  title?: string;
  description?: string;
  tags?: string[];
  items?: ThreadItemInput[];
};

const itemTypes = new Set<ResearchThreadItemType>(["DOCUMENT", "ANNOTATION", "CITATION", "SOURCE", "NOTE"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanTags(values: unknown) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(clean).filter(Boolean))].slice(0, 25);
}

function normalizeItems(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values.map((value, index) => {
    const item = value as ThreadItemInput;
    const itemType = itemTypes.has(item.itemType as ResearchThreadItemType) ? item.itemType as ResearchThreadItemType : null;
    const note = clean(item.note);
    const itemId = clean(item.itemId) || (itemType === "NOTE" ? `note-${index + 1}` : "");

    if (!itemType) {
      throw new Error("Research thread itemType must be DOCUMENT, ANNOTATION, CITATION, SOURCE, or NOTE.");
    }

    if (!itemId) {
      throw new Error("Research thread itemId is required for non-note items.");
    }

    return {
      itemType,
      itemId,
      note: note || null,
      orderIndex: Number.isInteger(item.orderIndex) ? Number(item.orderIndex) : index
    };
  });
}

async function buildThreadContext(threadId: string) {
  const thread = await prisma.researchThread.findUnique({
    where: { id: threadId },
    include: {
      tags: { orderBy: { value: "asc" } },
      items: { orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }] }
    }
  });

  if (!thread) return null;

  const annotationIds = thread.items.filter((item) => item.itemType === "ANNOTATION").map((item) => item.itemId);
  const citationIds = thread.items.filter((item) => item.itemType === "CITATION").map((item) => item.itemId);
  const sourceIds = thread.items.filter((item) => item.itemType === "SOURCE").map((item) => item.itemId);
  const documentIds = thread.items.filter((item) => item.itemType === "DOCUMENT").map((item) => item.itemId);

  const [annotations, citations, sources, documents] = await Promise.all([
    annotationIds.length ? prisma.annotation.findMany({
      where: { id: { in: annotationIds } },
      include: {
        document: true,
        version: true,
        pageMap: true,
        tags: true,
        citations: { include: { source: true } }
      }
    }) : [],
    citationIds.length ? prisma.citation.findMany({
      where: { id: { in: citationIds } },
      include: { source: true, annotation: { include: { document: true, pageMap: true } } }
    }) : [],
    sourceIds.length ? prisma.source.findMany({
      where: { id: { in: sourceIds } },
      include: { document: true }
    }) : [],
    documentIds.length ? prisma.document.findMany({
      where: { id: { in: documentIds } },
      include: { sources: true, versions: { orderBy: { createdAt: "desc" }, take: 3 } }
    }) : []
  ]);

  const annotationMap = new Map(annotations.map((value) => [value.id, value]));
  const citationMap = new Map(citations.map((value) => [value.id, value]));
  const sourceMap = new Map(sources.map((value) => [value.id, value]));
  const documentMap = new Map(documents.map((value) => [value.id, value]));

  return {
    ...thread,
    items: thread.items.map((item) => ({
      ...item,
      context:
        item.itemType === "ANNOTATION" ? annotationMap.get(item.itemId) ?? null :
        item.itemType === "CITATION" ? citationMap.get(item.itemId) ?? null :
        item.itemType === "SOURCE" ? sourceMap.get(item.itemId) ?? null :
        item.itemType === "DOCUMENT" ? documentMap.get(item.itemId) ?? null :
        null
    }))
  };
}

export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get("threadId")?.trim();

  if (threadId) {
    const thread = await buildThreadContext(threadId);
    if (!thread) {
      return NextResponse.json({ error: "Research thread not found." }, { status: 404 });
    }
    return NextResponse.json({ thread });
  }

  const threads = await prisma.researchThread.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      tags: { orderBy: { value: "asc" } },
      _count: { select: { items: true } }
    }
  });

  return NextResponse.json({ threads });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ThreadPayload;
  const title = clean(body.title);
  const description = clean(body.description);
  const tags = cleanTags(body.tags);
  const items = normalizeItems(body.items);

  if (!title) {
    return NextResponse.json({ error: "Research thread title is required." }, { status: 400 });
  }

  const thread = await prisma.researchThread.create({
    data: {
      title,
      description: description || null,
      tags: { create: tags.map((value) => ({ value })) },
      items: { create: items }
    },
    include: {
      tags: { orderBy: { value: "asc" } },
      items: { orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }] }
    }
  });

  const hydrated = await buildThreadContext(thread.id);
  return NextResponse.json({ thread: hydrated ?? thread }, { status: 201 });
}
