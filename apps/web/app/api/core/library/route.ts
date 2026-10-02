import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { storedFileSize } from "../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lists every document stored on the server so one can be reopened when the
// browser has lost track of it (cleared storage, a different address or port).
export async function GET(request: NextRequest) {
  const onlyDocumentId = request.nextUrl.searchParams.get("documentId")?.trim();
  const documents = await prisma.document.findMany({
    where: { kind: { in: ["PDF", "TXT", "MARKDOWN", "DOCX"] }, ...(onlyDocumentId ? { id: onlyDocumentId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      _count: { select: { annotations: true } },
      sources: { orderBy: { createdAt: "asc" }, take: 1 },
      versions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { _count: { select: { textSpans: true } }, pages: { orderBy: { pdfPageIndex: "asc" }, take: 1 } }
      }
    }
  });

  const entries = await Promise.all(
    documents.flatMap((document) => {
      const version = document.versions[0];
      const source = document.sources[0];
      const pageMap = version?.pages[0];
      if (!version || !source || !pageMap) return [];
      return [
        (async () => ({
          documentId: document.id,
          title: document.title,
          kind: document.kind as "PDF" | "TXT" | "MARKDOWN" | "DOCX",
          filename: document.originalFilename ?? document.title,
          mediaType: document.mediaType ?? "application/octet-stream",
          size: document.storageKey ? await storedFileSize(document.storageKey) : null,
          storageKey: document.storageKey,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          annotationCount: document._count.annotations,
          pageCount: version._count.textSpans || null,
          fileMissing: Boolean(document.storageKey) && (await storedFileSize(document.storageKey as string)) === null,
          versionId: version.id,
          snapshotKey: version.snapshotKey,
          sourceChecksum: version.sourceChecksum,
          sourceId: source.id,
          cslJson: source.cslJson,
          pageMapId: pageMap.id,
          pdfPageIndex: pageMap.pdfPageIndex,
          pageMapNote: pageMap.note,
          bookPageLabel: pageMap.bookPageLabel
        }))()
      ];
    })
  );

  return NextResponse.json({ count: entries.length, documents: entries });
}
