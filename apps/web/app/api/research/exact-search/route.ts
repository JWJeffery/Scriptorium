import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchKind = "document" | "text-span" | "annotation" | "annotation-tag" | "citation" | "thread" | "thread-tag";

type SearchResult = {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
  documentId?: string;
  sourceId?: string;
  annotationId?: string;
  citationId?: string;
  threadId?: string;
  locator?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedQuery(value: string | null) {
  const query = clean(value).slice(0, 160);
  if (query.length < 2) return "";
  return query;
}

function boundedLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "25", 10);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), 50);
}

function snippet(value: unknown, query: string) {
  const text = clean(value).replace(/\s+/g, " ");
  if (!text) return "";
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text.slice(0, 240);
  const start = Math.max(index - 80, 0);
  const end = Math.min(index + query.length + 160, text.length);
  return text.slice(start, end);
}

function sourceTitle(source: { shortTitle?: string | null } | null | undefined) {
  return clean(source?.shortTitle) || "Untitled source";
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

  if (!query) {
    return NextResponse.json({ error: "q must be at least two characters." }, { status: 400 });
  }

  const perBucket = Math.max(1, Math.ceil(limit / 7));
  const contains = { contains: query };

  const [documents, textSpans, annotations, annotationTags, citations, threads, threadTags] = await Promise.all([
    prisma.document.findMany({
      where: { OR: [{ title: contains }, { originalFilename: contains }] },
      include: { sources: true },
      take: perBucket,
      orderBy: { updatedAt: "desc" }
    }),
    prisma.textSpan.findMany({
      where: { text: contains },
      include: { pageMap: true, version: { include: { document: { include: { sources: true } } } } },
      take: perBucket,
      orderBy: { createdAt: "desc" }
    }),
    prisma.annotation.findMany({
      where: { OR: [{ selectedText: contains }, { note: contains }] },
      include: { document: true, pageMap: true, citations: { include: { source: true } }, tags: true },
      take: perBucket,
      orderBy: { updatedAt: "desc" }
    }),
    prisma.annotationTag.findMany({
      where: { value: contains },
      include: { annotation: { include: { document: true, pageMap: true, citations: { include: { source: true } } } } },
      take: perBucket
    }),
    prisma.citation.findMany({
      where: { generatedText: contains },
      include: { source: true, annotation: { include: { document: true, pageMap: true } } },
      take: perBucket,
      orderBy: { createdAt: "desc" }
    }),
    prisma.researchThread.findMany({
      where: { OR: [{ title: contains }, { description: contains }] },
      include: { tags: true, items: { orderBy: { orderIndex: "asc" } } },
      take: perBucket,
      orderBy: { updatedAt: "desc" }
    }),
    prisma.researchThreadTag.findMany({
      where: { value: contains },
      include: { researchThread: { include: { tags: true, items: { orderBy: { orderIndex: "asc" } } } } },
      take: perBucket
    })
  ]);

  const results: SearchResult[] = [
    ...documents.map((document) => ({
      kind: "document" as const,
      id: document.id,
      title: documentTitle(document),
      snippet: snippet(`${document.title} ${document.originalFilename ?? ""}`, query),
      documentId: document.id,
      sourceId: document.sources[0]?.id
    })),
    ...textSpans.map((span) => ({
      kind: "text-span" as const,
      id: span.id,
      title: documentTitle(span.version.document),
      snippet: snippet(span.text, query),
      documentId: span.version.documentId,
      sourceId: span.version.document.sources[0]?.id,
      locator: locator(span.pageMap)
    })),
    ...annotations.map((annotation) => ({
      kind: "annotation" as const,
      id: annotation.id,
      title: documentTitle(annotation.document),
      snippet: snippet(`${annotation.selectedText} ${annotation.note ?? ""}`, query),
      documentId: annotation.documentId,
      annotationId: annotation.id,
      sourceId: annotation.citations[0]?.sourceId,
      citationId: annotation.citations[0]?.id,
      locator: locator(annotation.pageMap)
    })),
    ...annotationTags.map((tag) => ({
      kind: "annotation-tag" as const,
      id: tag.id,
      title: `Annotation tag: ${tag.value}`,
      snippet: snippet(`${tag.value} ${tag.annotation.selectedText}`, query),
      documentId: tag.annotation.documentId,
      annotationId: tag.annotationId,
      sourceId: tag.annotation.citations[0]?.sourceId,
      citationId: tag.annotation.citations[0]?.id,
      locator: locator(tag.annotation.pageMap)
    })),
    ...citations.map((citation) => ({
      kind: "citation" as const,
      id: citation.id,
      title: sourceTitle(citation.source),
      snippet: snippet(citation.generatedText, query),
      documentId: citation.annotation?.documentId,
      sourceId: citation.sourceId,
      annotationId: citation.annotationId ?? undefined,
      citationId: citation.id,
      locator: locator(citation.annotation?.pageMap, citation.locatorType, citation.locatorValue)
    })),
    ...threads.map((thread) => ({
      kind: "thread" as const,
      id: thread.id,
      title: thread.title,
      snippet: snippet(`${thread.title} ${thread.description ?? ""} ${thread.tags.map((tag) => tag.value).join(" ")}`, query),
      threadId: thread.id
    })),
    ...threadTags.map((tag) => ({
      kind: "thread-tag" as const,
      id: tag.id,
      title: `Thread tag: ${tag.value}`,
      snippet: snippet(`${tag.value} ${tag.researchThread.title}`, query),
      threadId: tag.researchThreadId
    }))
  ].slice(0, limit);

  await prisma.queryLog.create({
    data: {
      query,
      mode: "exact-search",
      filters: { limit },
      resultIds: results.map((result) => ({ kind: result.kind, id: result.id }))
    }
  });

  return NextResponse.json({ query, mode: "exact-search", limit, count: results.length, results });
}
