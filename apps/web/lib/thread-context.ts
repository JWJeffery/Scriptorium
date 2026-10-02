import { prisma } from "./prisma";

// Loads a research thread with everything its items point at, in one shape
// shared by the thread API and the exporters.

export type ThreadItemContext =
  | {
      itemType: "ANNOTATION";
      documentId: string;
      documentTitle: string;
      versionId: string;
      pdfPageIndex: number | null;
      bookPage: string | null;
      colorKey: string;
      selectedText: string;
      note: string;
      tags: string[];
      citationText: string;
      sourceId: string | null;
    }
  | { itemType: "DOCUMENT"; documentId: string; documentTitle: string }
  | { itemType: "SOURCE"; sourceId: string; title: string; citationText: string }
  | { itemType: "CITATION"; citationText: string; sourceId: string; annotationId: string | null }
  | { itemType: "NOTE" }
  | null; // the thing this item pointed at no longer exists

export type ThreadItemView = { id: string; itemType: string; itemId: string; note: string; orderIndex: number; context: ThreadItemContext };
export type ThreadView = { id: string; title: string; description: string; tags: string[]; createdAt: Date; updatedAt: Date; items: ThreadItemView[] };

type CslLike = { title?: string; author?: Array<{ literal?: string; given?: string; family?: string }>; issued?: { "date-parts"?: unknown[][] } };

function plainSourceLine(source: { shortTitle: string | null; cslJson: unknown }) {
  const csl = (typeof source.cslJson === "object" && source.cslJson !== null ? source.cslJson : {}) as CslLike;
  const author = csl.author?.[0];
  const name = author?.literal ?? [author?.given, author?.family].filter(Boolean).join(" ");
  const year = csl.issued?.["date-parts"]?.[0]?.[0];
  return [name, csl.title ?? source.shortTitle, year].filter(Boolean).join(", ");
}

export async function loadThread(threadId: string): Promise<ThreadView | null> {
  const thread = await prisma.researchThread.findUnique({
    where: { id: threadId },
    include: { tags: { orderBy: { value: "asc" } }, items: { orderBy: { orderIndex: "asc" } } }
  });
  if (!thread) return null;

  const idsOf = (type: string) => thread.items.filter((item) => item.itemType === type).map((item) => item.itemId);
  const [annotations, citations, sources, documents] = await Promise.all([
    prisma.annotation.findMany({
      where: { id: { in: idsOf("ANNOTATION") } },
      include: { document: { select: { title: true } }, tags: true, citations: { orderBy: { createdAt: "desc" }, take: 1 } }
    }),
    prisma.citation.findMany({ where: { id: { in: idsOf("CITATION") } } }),
    prisma.source.findMany({ where: { id: { in: idsOf("SOURCE") } } }),
    prisma.document.findMany({ where: { id: { in: idsOf("DOCUMENT") } }, select: { id: true, title: true } })
  ]);
  const annotationById = new Map(annotations.map((value) => [value.id, value]));
  const citationById = new Map(citations.map((value) => [value.id, value]));
  const sourceById = new Map(sources.map((value) => [value.id, value]));
  const documentById = new Map(documents.map((value) => [value.id, value]));

  function contextFor(item: { itemType: string; itemId: string }): ThreadItemContext {
    if (item.itemType === "NOTE") return { itemType: "NOTE" };
    if (item.itemType === "ANNOTATION") {
      const annotation = annotationById.get(item.itemId);
      if (!annotation) return null;
      const anchor = annotation.anchor as { pageNumber?: number } | null;
      const citation = annotation.citations[0];
      return {
        itemType: "ANNOTATION",
        documentId: annotation.documentId,
        documentTitle: annotation.document.title,
        versionId: annotation.versionId,
        pdfPageIndex: typeof anchor?.pageNumber === "number" ? anchor.pageNumber : null,
        bookPage: citation?.locatorValue ?? null,
        colorKey: annotation.colorKey,
        selectedText: annotation.selectedText,
        note: annotation.note ?? "",
        tags: annotation.tags.map((tag) => tag.value),
        citationText: citation?.generatedText ?? "",
        sourceId: citation?.sourceId ?? null
      };
    }
    if (item.itemType === "CITATION") {
      const citation = citationById.get(item.itemId);
      return citation ? { itemType: "CITATION", citationText: citation.generatedText, sourceId: citation.sourceId, annotationId: citation.annotationId } : null;
    }
    if (item.itemType === "SOURCE") {
      const source = sourceById.get(item.itemId);
      return source ? { itemType: "SOURCE", sourceId: source.id, title: source.shortTitle ?? "Untitled source", citationText: plainSourceLine(source) } : null;
    }
    if (item.itemType === "DOCUMENT") {
      const document = documentById.get(item.itemId);
      return document ? { itemType: "DOCUMENT", documentId: document.id, documentTitle: document.title } : null;
    }
    return null;
  }

  return {
    id: thread.id,
    title: thread.title,
    description: thread.description ?? "",
    tags: thread.tags.map((tag) => tag.value),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    items: thread.items.map((item) => ({ id: item.id, itemType: item.itemType, itemId: item.itemId, note: item.note ?? "", orderIndex: item.orderIndex, context: contextFor(item) }))
  };
}
