import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backs a data-integrity check in the reader (PdfAnchoredPageReader), not a
// content feature: the reader's manual text selection reads directly from
// pdf.js's own text layer, which can silently return corrupted/garbled
// characters on PDFs with malformed embedded fonts - pdf.js has no way to
// tell you when this happens, it just returns whatever it parsed. This
// route exposes the independently-derived, more trustworthy text (server
// extraction on ingest, or a later real OCR pass) for the same page, so a
// captured selection can be checked against it before the person saves it
// as if it were a verified quotation.
export async function GET(request: NextRequest) {
  const versionId = request.nextUrl.searchParams.get("versionId")?.trim();
  const pdfPageIndexRaw = request.nextUrl.searchParams.get("pdfPageIndex");
  const pdfPageIndex = pdfPageIndexRaw ? Number(pdfPageIndexRaw) : NaN;

  if (!versionId || !Number.isFinite(pdfPageIndex)) {
    return NextResponse.json({ error: "versionId and a numeric pdfPageIndex are required." }, { status: 400 });
  }

  const spans = await prisma.textSpan.findMany({ where: { versionId } });
  const match = spans.find((span) => {
    const anchor = span.anchor as { pdfPageIndex?: number; ocr?: boolean } | null;
    return anchor?.pdfPageIndex === pdfPageIndex;
  });

  if (!match || !match.text.trim()) {
    return NextResponse.json({ text: null, source: null });
  }

  const anchor = match.anchor as { ocr?: boolean } | null;
  return NextResponse.json({ text: match.text, source: anchor?.ocr ? "ocr" : "extraction" });
}
