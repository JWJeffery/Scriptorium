import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import type { OcrWord } from "../../../../lib/ocr-provider";
import { createSearchablePdf, type OcrPageLayer } from "../../../../lib/searchable-pdf";
import { readStoredPdfFile, safeStorageSegment } from "../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OcrAnchor = {
  pdfPageIndex?: number;
  ocr?: boolean;
  words?: OcrWord[];
};

export async function GET(request: NextRequest) {
  const versionId = request.nextUrl.searchParams.get("versionId")?.trim();
  if (!versionId) {
    return NextResponse.json({ error: "versionId is required." }, { status: 400 });
  }

  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    include: { document: true, textSpans: true }
  });
  if (!version) {
    return NextResponse.json({ error: "No document version found for that id." }, { status: 404 });
  }
  if (!version.snapshotKey) {
    return NextResponse.json({ error: "This document version has no stored PDF." }, { status: 422 });
  }

  const layers: OcrPageLayer[] = version.textSpans.flatMap((span) => {
    const anchor = span.anchor as OcrAnchor | null;
    if (!anchor?.ocr || !Number.isFinite(anchor.pdfPageIndex) || !anchor.words?.length) return [];
    return [{ pageIndex: anchor.pdfPageIndex as number, words: anchor.words }];
  });
  if (layers.length === 0) {
    return NextResponse.json({ error: "Run OCR on this document before downloading a searchable PDF." }, { status: 409 });
  }

  try {
    const storedPdf = await readStoredPdfFile(version.snapshotKey);
    const result = await createSearchablePdf(storedPdf, layers);
    if (result.embeddedWordCount === 0) {
      return NextResponse.json({ error: "OCR completed without usable positioned words to embed." }, { status: 422 });
    }
    const filename = `${safeStorageSegment(version.document.title, "scriptorium-document")}-searchable.pdf`;
    return new NextResponse(new Uint8Array(result.pdfBytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-scriptorium-ocr-words": String(result.embeddedWordCount)
      }
    });
  } catch (error) {
    console.error(`Could not build searchable PDF for version ${versionId}:`, error);
    return NextResponse.json({ error: "The searchable PDF could not be generated." }, { status: 500 });
  }
}
