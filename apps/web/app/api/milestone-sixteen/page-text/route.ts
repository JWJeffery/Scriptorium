import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backs two things in the reader (PdfAnchoredPageReader):
// 1. A data-integrity check: the reader's manual text selection normally
//    reads directly from pdf.js's own text layer, which can silently return
//    corrupted/garbled characters on PDFs with malformed embedded fonts -
//    pdf.js has no way to tell you when this happens, it just returns
//    whatever it parsed.
// 2. Where real OCR word-level positions exist (from a page Tesseract
//    actually ran on), the reader uses them directly to build its
//    selectable text layer *instead of* pdf.js's own - not just to warn
//    after the fact, but so selection is correct in the first place.
// This route exposes whichever independently-derived text/positions exist
// for a page (server extraction on ingest, or a later real OCR pass).
export async function GET(request: NextRequest) {
  const versionId = request.nextUrl.searchParams.get("versionId")?.trim();
  const pdfPageIndexRaw = request.nextUrl.searchParams.get("pdfPageIndex");
  const pdfPageIndex = pdfPageIndexRaw ? Number(pdfPageIndexRaw) : NaN;

  if (!versionId || !Number.isFinite(pdfPageIndex)) {
    return NextResponse.json({ error: "versionId and a numeric pdfPageIndex are required." }, { status: 400 });
  }

  // Filter in the database: a scanned book has one large row per page, and
  // loading all of them just to read one made every page turn slow.
  const match = await prisma.textSpan.findFirst({
    where: { versionId, anchor: { path: "$.pdfPageIndex", equals: pdfPageIndex } }
  });

  if (!match || !match.text.trim()) {
    return NextResponse.json({ text: null, source: null, words: null });
  }

  const anchor = match.anchor as {
    ocr?: boolean;
    words?: {
      text: string;
      left: number;
      top: number;
      width: number;
      height: number;
      confidence: number;
      blockNum?: number;
      lineNum?: number;
    }[];
  } | null;
  return NextResponse.json({
    text: match.text,
    source: anchor?.ocr ? "ocr" : "extraction",
    words: anchor?.words && anchor.words.length > 0 ? anchor.words : null
  });
}
