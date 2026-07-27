import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { detectLikelyScanned } from "../../../../lib/ocr-provider";
import { tesseractOcrProvider } from "../../../../lib/tesseract-ocr-provider";
import { readStoredPdfFile } from "../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  const documentId = clean(request.nextUrl.searchParams.get("documentId"));

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: documentId || undefined, document: { kind: "PDF" } },
    include: { pages: true, textSpans: true, document: true },
    orderBy: { createdAt: "desc" }
  });

  const results = versions.map((version) => {
    const extractedTextLength = version.textSpans.reduce((sum, span) => sum + span.text.length, 0);
    // Real page count now comes from the per-page TextSpans that ingestion
    // (and OCR) create - one row per PDF page. Falls back to the PageMap
    // count (historically just 1, the page registered at ingest time) for
    // documents registered before that existed, so old records don't
    // divide-by-a-wrong-number instead of just being less precise.
    const pageCount = version.textSpans.length || version.pages.length || 1;
    const detection = detectLikelyScanned({ extractedTextLength, pageCount });

    return {
      versionId: version.id,
      documentId: version.documentId,
      documentTitle: version.document.title,
      extractionState: version.extractionState,
      pageCount,
      extractedTextLength,
      ...detection
    };
  });

  return NextResponse.json({
    count: results.length,
    likelyScannedCount: results.filter((r) => r.likelyScanned).length,
    results
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { versionId?: string };
  const versionId = clean(body.versionId);

  if (!versionId) {
    return NextResponse.json({ error: "versionId is required." }, { status: 400 });
  }

  const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
  if (!version) {
    return NextResponse.json({ error: "No document version found for that id." }, { status: 404 });
  }
  if (!version.snapshotKey) {
    return NextResponse.json(
      { error: "No server-stored PDF file is available for this version, so there's nothing to OCR." },
      { status: 422 }
    );
  }

  let pdfBytes: Buffer;
  try {
    pdfBytes = await readStoredPdfFile(version.snapshotKey);
  } catch {
    return NextResponse.json({ error: "The stored PDF file could not be read from disk." }, { status: 500 });
  }

  try {
    const result = await tesseractOcrProvider.extractText({ pdfBytes, documentId: version.documentId });

    if (result.pages && result.pages.length > 0) {
      // OCR results replace whatever TextSpans this version had (from
      // ingestion's empty-text spans on a real scan). This intentionally
      // loses the one pageMapId link ingestion set on the registered page -
      // that link isn't used for anything OCR-relevant, and re-deriving it
      // here isn't worth the complexity for a first pass.
      await prisma.$transaction([
        prisma.textSpan.deleteMany({ where: { versionId } }),
        prisma.textSpan.createMany({
          data: result.pages.map((page) => ({
            versionId,
            text: page.text,
            anchor: { pdfPageIndex: page.pageIndex, ocr: true, confidence: page.confidence }
          }))
        }),
        prisma.documentVersion.update({
          where: { id: versionId },
          data: { extractionState: tesseractOcrProvider.name }
        })
      ]);
    }

    return NextResponse.json({
      ocrRan: true,
      pagesProcessed: result.pages?.length ?? 0,
      totalCharactersExtracted: result.text.length,
      warnings: result.warnings
    });
  } catch (error) {
    return NextResponse.json(
      { ocrRan: false, error: error instanceof Error ? error.message : "OCR failed." },
      { status: 500 }
    );
  }
}
