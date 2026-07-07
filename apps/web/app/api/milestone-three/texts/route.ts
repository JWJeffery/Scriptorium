import { NextRequest, NextResponse } from "next/server";
import type { DocumentKind, Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { storeTextSnapshot } from "../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParsedSource = {
  title: string;
  author?: string;
  place?: string;
  publisher?: string;
  year?: string;
};

function readText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseDocumentKind(file: File): DocumentKind | null {
  const filename = file.name.toLowerCase();

  if (file.type === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown")) return "MARKDOWN";
  if (file.type === "text/plain" || filename.endsWith(".txt")) return "TXT";
  return null;
}

function cslJsonFor(source: ParsedSource): Prisma.InputJsonObject {
  const numericYear = source.year ? Number(source.year) : undefined;
  const json = {
    type: "book",
    title: source.title,
    author: source.author ? [{ literal: source.author }] : undefined,
    publisher: source.publisher || undefined,
    "publisher-place": source.place || undefined,
    issued: source.year ? { "date-parts": [[Number.isFinite(numericYear) ? numericYear : source.year]] } : undefined
  };

  return JSON.parse(JSON.stringify(json)) as Prisma.InputJsonObject;
}

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function findReusableDocument(documentId: string, kind: DocumentKind) {
  if (!documentId) return null;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { sources: { orderBy: { createdAt: "asc" }, take: 1 } }
  });

  if (!document || (document.kind !== "TXT" && document.kind !== "MARKDOWN")) return null;
  if (document.kind !== kind) return null;
  return document;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return failure("TXT or Markdown file is required.", 400);
  }

  const kind = parseDocumentKind(file);
  if (!kind) {
    return failure("Only .txt and .md/.markdown files are accepted for this gate.", 400);
  }

  const rawText = await file.text();
  if (!rawText.trim()) {
    return failure("Text file is empty.", 400);
  }

  const title = readText(formData, "title") || file.name.replace(/\.(txt|md|markdown)$/i, "");
  const locatorValue = readText(formData, "bookPageLabel") || "1";
  const requestedDocumentId = readText(formData, "documentId");
  const source: ParsedSource = {
    title,
    author: readText(formData, "author") || undefined,
    place: readText(formData, "place") || undefined,
    publisher: readText(formData, "publisher") || undefined,
    year: readText(formData, "year") || undefined
  };

  const reusableDocument = await findReusableDocument(requestedDocumentId, kind);

  const result = await prisma.$transaction(async (tx) => {
    const document = reusableDocument
      ? await tx.document.update({
          where: { id: reusableDocument.id },
          data: {
            title,
            originalFilename: file.name,
            mediaType: file.type || (kind === "MARKDOWN" ? "text/markdown" : "text/plain")
          }
        })
      : await tx.document.create({
          data: {
            title,
            originalFilename: file.name,
            kind,
            mediaType: file.type || (kind === "MARKDOWN" ? "text/markdown" : "text/plain"),
            storageKey: null
          }
        });

    const storedSnapshot = await storeTextSnapshot(document.id, rawText);

    const updatedDocument = await tx.document.update({
      where: { id: document.id },
      data: { storageKey: storedSnapshot.storageKey }
    });

    const versionCount = await tx.documentVersion.count({ where: { documentId: document.id } });

    const version = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        sourceChecksum: storedSnapshot.checksum,
        snapshotKind: "TEXT_EXTRACTION",
        snapshotKey: storedSnapshot.storageKey,
        extractionState: `${kind === "MARKDOWN" ? "markdown" : "plain-text"}-snapshot-v${versionCount + 1}`
      }
    });

    const sourceRecord = reusableDocument?.sources[0]
      ? await tx.source.update({
          where: { id: reusableDocument.sources[0].id },
          data: {
            shortTitle: source.title,
            cslJson: cslJsonFor(source)
          }
        })
      : await tx.source.create({
          data: {
            documentId: document.id,
            shortTitle: source.title,
            cslJson: cslJsonFor(source)
          }
        });

    const pageMap = await tx.pageMap.create({
      data: {
        versionId: version.id,
        pdfPageIndex: 1,
        visibleLabel: `snapshot ${versionCount + 1}`,
        bookPageLabel: locatorValue,
        numberingSystem: "CUSTOM",
        confidence: "USER_CONFIRMED",
        note: `Text-format snapshot v${versionCount + 1}: checksum ${storedSnapshot.checksum}; line locators derive from normalized text offsets.`
      }
    });

    const textSpan = await tx.textSpan.create({
      data: {
        versionId: version.id,
        pageMapId: pageMap.id,
        text: storedSnapshot.text,
        anchor: {
          kind,
          locatorKind: "line",
          sourceChecksum: storedSnapshot.checksum,
          snapshotKey: storedSnapshot.storageKey,
          textLength: storedSnapshot.text.length,
          lineCount: storedSnapshot.lineCount,
          versionOrdinal: versionCount + 1
        }
      }
    });

    return { document: updatedDocument, version, source: sourceRecord, pageMap, textSpan, storedSnapshot };
  });

  return NextResponse.json(result, { status: reusableDocument ? 200 : 201 });
}
