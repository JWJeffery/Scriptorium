import { NextRequest, NextResponse } from "next/server";
import type { DocumentKind, Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";

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

  const text = await file.text();
  if (!text.trim()) {
    return failure("Text file is empty.", 400);
  }

  const title = readText(formData, "title") || file.name.replace(/\.(txt|md|markdown)$/i, "");
  const locatorValue = readText(formData, "bookPageLabel") || "1";
  const source: ParsedSource = {
    title,
    author: readText(formData, "author") || undefined,
    place: readText(formData, "place") || undefined,
    publisher: readText(formData, "publisher") || undefined,
    year: readText(formData, "year") || undefined
  };

  const result = await prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        title,
        originalFilename: file.name,
        kind,
        mediaType: file.type || (kind === "MARKDOWN" ? "text/markdown" : "text/plain"),
        storageKey: null
      }
    });

    const version = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        snapshotKind: "TEXT_EXTRACTION",
        extractionState: kind === "MARKDOWN" ? "markdown-text-snapshot" : "plain-text-snapshot"
      }
    });

    const sourceRecord = await tx.source.create({
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
        visibleLabel: "text",
        bookPageLabel: locatorValue,
        numberingSystem: "CUSTOM",
        confidence: "USER_CONFIRMED",
        note: "Text-format snapshot uses line locators captured from normalized text offsets."
      }
    });

    const textSpan = await tx.textSpan.create({
      data: {
        versionId: version.id,
        pageMapId: pageMap.id,
        text,
        anchor: {
          kind,
          locatorKind: "line",
          textLength: text.length,
          lineCount: text.split("\n").length
        }
      }
    });

    return { document, version, source: sourceRecord, pageMap, textSpan };
  });

  return NextResponse.json(result, { status: 201 });
}
