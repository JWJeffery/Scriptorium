import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import type { MilestoneOneDocumentInput } from "../../../../lib/milestone-one-types";

function cslJsonFor(input: MilestoneOneDocumentInput) {
  const cslItem: Record<string, unknown> = {
    type: "book",
    title: input.source.title || input.title
  };

  if (input.source.author) {
    cslItem.author = [{ literal: input.source.author }];
  }

  if (input.source.publisher) {
    cslItem.publisher = input.source.publisher;
  }

  if (input.source.place) {
    cslItem["publisher-place"] = input.source.place;
  }

  if (input.source.year) {
    const numericYear = Number(input.source.year);
    cslItem.issued = {
      "date-parts": [[Number.isFinite(numericYear) ? numericYear : input.source.year]]
    };
  }

  return cslItem;
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
