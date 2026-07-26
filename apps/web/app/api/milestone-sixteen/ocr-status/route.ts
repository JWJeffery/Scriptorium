import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { detectLikelyScanned, nullOcrProvider, OcrNotConfiguredError } from "../../../../lib/ocr-provider";

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
    const pageCount = version.pages.length || 1;
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

  try {
    // No pdfBytes are loaded here on purpose: the null provider always
    // throws before touching them, and wiring real file loading only
    // matters once a real provider exists to consume it.
    await nullOcrProvider.extractText({ pdfBytes: Buffer.alloc(0), documentId: versionId });
    // Unreachable while nullOcrProvider is in use, but kept so a future real
    // provider slots in without changing this route's shape.
    return NextResponse.json({ ocrRan: true });
  } catch (error) {
    if (error instanceof OcrNotConfiguredError) {
      return NextResponse.json({ ocrRan: false, error: error.message }, { status: 501 });
    }
    throw error;
  }
}
