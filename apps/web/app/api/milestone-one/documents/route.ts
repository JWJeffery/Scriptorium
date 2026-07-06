import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import type { MilestoneOneDocumentInput } from "../../../../lib/milestone-one-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cslJsonFor(input: MilestoneOneDocumentInput): Prisma.InputJsonObject {
  const numericYear = input.source.year ? Number(input.source.year) : undefined;
  const json = {
    type: "book",
    title: input.source.title || input.title,
    author: input.source.author ? [{ literal: input.source.author }] : undefined,
    publisher: input.source.publisher || undefined,
    "publisher-place": input.source.place || undefined,
    issued: input.source.year
      ? { "date-parts": [[Number.isFinite(numericYear) ? numericYear : input.source.year]] }
      : undefined
  };

  return JSON.parse(JSON.stringify(json)) as Prisma.InputJsonObject;
}

function isValidInput(value: unknown): value is MilestoneOneDocumentInput {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Partial<MilestoneOneDocumentInput>;
  return Boolean(input.title && input.filename && input.mediaType && input.source && input.pageMap);
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as unknown;

  if (!isValidInput(body)) {
    return NextResponse.json({ error: "Invalid document payload." }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        title: body.title,
        originalFilename: body.filename,
        kind: "PDF",
        mediaType: body.mediaType,
        storageKey: null
      }
    });

    const version = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        snapshotKind: "PDF_RENDERING",
        extractionState: "browser-local-pdfjs"
      }
    });

    const source = await tx.source.create({
      data: {
        documentId: document.id,
        shortTitle: body.source.title || body.title,
        cslJson: cslJsonFor(body)
      }
    });

    const pageMap = await tx.pageMap.create({
      data: {
        versionId: version.id,
        pdfPageIndex: body.pageMap.currentPdfPageIndex,
        bookPageLabel: body.pageMap.bookPageLabel,
        numberingSystem: "ARABIC",
        confidence: "USER_CONFIRMED",
        note: `Mapping rule: PDF page ${body.pageMap.basePdfPageIndex} = book page ${body.pageMap.baseBookPage}`
      }
    });

    return { document, version, source, pageMap };
  });

  return NextResponse.json(result, { status: 201 });
}
