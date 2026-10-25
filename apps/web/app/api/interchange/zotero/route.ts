import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { exportZoteroItemJson, importZoteroItemJson } from "../../../../lib/zotero-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ZoteroImportPayload = {
  sourceId?: string;
  content?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  const sourceId = request.nextUrl.searchParams.get("sourceId")?.trim();

  if (!sourceId) {
    return NextResponse.json({ error: "sourceId is required." }, { status: 400 });
  }

  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }

  const content = exportZoteroItemJson(source.cslJson);
  return NextResponse.json({ sourceId: source.id, format: "zotero-item-json", content, cslJson: source.cslJson });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ZoteroImportPayload;
  const sourceId = clean(body.sourceId);
  const content = clean(body.content);

  if (!sourceId) {
    return NextResponse.json({ error: "sourceId is required." }, { status: 400 });
  }

  if (!content) {
    return NextResponse.json({ error: "content is required." }, { status: 400 });
  }

  try {
    const cslRecord = importZoteroItemJson(content);
    const source = await prisma.source.update({
      where: { id: sourceId },
      data: {
        shortTitle: cslRecord.title,
        cslJson: JSON.parse(JSON.stringify(cslRecord))
      }
    });

    return NextResponse.json({ source, format: "zotero-item-json", cslJson: cslRecord });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zotero import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
