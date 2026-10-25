import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { exportCitationRecord, importCitationRecord, type CitationExchangeFormat } from "../../../../lib/citation-exchange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedFormats = new Set<CitationExchangeFormat>(["csl-json", "bibtex", "biblatex"]);

type ImportPayload = {
  sourceId?: string;
  format?: CitationExchangeFormat;
  content?: string;
};

function formatFrom(value: string | null | undefined): CitationExchangeFormat | null {
  if (!value) return null;
  return allowedFormats.has(value as CitationExchangeFormat) ? value as CitationExchangeFormat : null;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  const sourceId = request.nextUrl.searchParams.get("sourceId")?.trim();
  const format = formatFrom(request.nextUrl.searchParams.get("format"));

  if (!sourceId) {
    return NextResponse.json({ error: "sourceId is required." }, { status: 400 });
  }

  if (!format) {
    return NextResponse.json({ error: "format must be csl-json, bibtex, or biblatex." }, { status: 400 });
  }

  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }

  const content = exportCitationRecord(format, source.cslJson);
  return NextResponse.json({ sourceId: source.id, format, content, cslJson: source.cslJson });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ImportPayload;
  const sourceId = clean(body.sourceId);
  const format = formatFrom(body.format);
  const content = clean(body.content);

  if (!sourceId) {
    return NextResponse.json({ error: "sourceId is required." }, { status: 400 });
  }

  if (!format) {
    return NextResponse.json({ error: "format must be csl-json, bibtex, or biblatex." }, { status: 400 });
  }

  if (!content) {
    return NextResponse.json({ error: "content is required." }, { status: 400 });
  }

  try {
    const cslRecord = importCitationRecord(format, content);
    const source = await prisma.source.update({
      where: { id: sourceId },
      data: {
        shortTitle: cslRecord.title,
        cslJson: JSON.parse(JSON.stringify(cslRecord))
      }
    });

    return NextResponse.json({ source, format, cslJson: cslRecord });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Citation import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
