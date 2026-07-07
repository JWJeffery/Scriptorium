import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { extractDocxRawText } from "../../../../lib/docx-extraction";
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

function isDocxFile(file: File) {
  return file.name.toLowerCase().endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
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

async function reusableDocx(documentId: string) {
  if (!documentId) return null;
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { sources: { orderBy: { createdAt: "asc" }, take: 1 } }
  });
  return document?.kind === "DOCX" ? document : null;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || !isDocxFile(file)) {
    return NextResponse.json({ error: "A .docx file is required." }, { status: 400 });
  }

  const extracted = await extractDocxRawText(file);
  const title = readText(formData, "title") || file.name.replace(/\.docx$/i, "");
  const existingDocumentId = readText(formData, "documentId");
  const existingDocument = await reusableDocx(existingDocumentId);
  const source: ParsedSource = {
    title,
    author: readText(formData, "author") || undefined,
    place: readText(formData, "place") || undefined,
    publisher: readText(formData, "publisher") || undefined,
    year: readText(formData, "year") || undefined
  };

  const result = await prisma.$transaction(async (tx) => {
    const document = existingDocument
      ? await tx.document.update({
          where: { id: existingDocument.id },
          data: { title, originalFilename: file.name, mediaType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
        })
      : await tx.document.create({
          data: { title, originalFilename: file.name, kind: "DOCX", mediaType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
        });

    const storedSnapshot = await storeTextSnapshot(document.id, extracted.text);
    const updatedDocument = await tx.document.update({ where: { id: document.id }, data: { storageKey: storedSnapshot.storageKey } });
    const versionCount = await tx.documentVersion.count({ where: { documentId: document.id } });

    const version = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        sourceChecksum: storedSnapshot.checksum,
        snapshotKind: "TEXT_EXTRACTION",
        snapshotKey: storedSnapshot.storageKey,
        extractionState: `docx-text-snapshot-v${versionCount + 1}`
      }
    });

    const sourceRecord = existingDocument?.sources[0]
      ? await tx.source.update({ where: { id: existingDocument.sources[0].id }, data: { shortTitle: source.title, cslJson: cslJsonFor(source) } })
      : await tx.source.create({ data: { documentId: document.id, shortTitle: source.title, cslJson: cslJsonFor(source) } });

    const pageMap = await tx.pageMap.create({
      data: {
        versionId: version.id,
        pdfPageIndex: 1,
        visibleLabel: `docx snapshot ${versionCount + 1}`,
        bookPageLabel: readText(formData, "bookPageLabel") || "1",
        numberingSystem: "CUSTOM",
        confidence: "IMPORTED",
        note: `DOCX text snapshot checksum ${storedSnapshot.checksum}.`
      }
    });

    const textSpan = await tx.textSpan.create({
      data: {
        versionId: version.id,
        pageMapId: pageMap.id,
        text: storedSnapshot.text,
        anchor: {
          kind: "DOCX",
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

  return NextResponse.json(result, { status: existingDocument ? 200 : 201 });
}
