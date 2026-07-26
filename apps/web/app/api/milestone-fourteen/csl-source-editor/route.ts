import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { normalizeCslBookRecord, cslToInputJson } from "../../../../lib/citation-exchange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Expanded CSL source editor (Milestone 14). The original Milestone 6 route
// at /api/milestone-six/sources is intentionally left untouched — it's
// already audited/closed and scoped to plain books. This route is additive:
// same underlying Source table, but accepts the fuller CSL item shape
// (chapter/article-journal/manuscript, editor, translator, container-title,
// volume, edition) via the shared normalizer in lib/citation-exchange.ts.

type SourceEditorInput = {
  sourceId?: string;
  type?: string;
  title?: string;
  author?: string;
  editor?: string;
  translator?: string;
  containerTitle?: string;
  place?: string;
  publisher?: string;
  volume?: string;
  edition?: string;
  year?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as SourceEditorInput;
  const sourceId = clean(body.sourceId);

  if (!sourceId) {
    return NextResponse.json({ error: "sourceId is required." }, { status: 400 });
  }

  let normalized;
  try {
    normalized = normalizeCslBookRecord({
      type: clean(body.type) || "book",
      title: clean(body.title),
      author: clean(body.author) ? [{ literal: clean(body.author) }] : undefined,
      editor: clean(body.editor) ? [{ literal: clean(body.editor) }] : undefined,
      translator: clean(body.translator) ? [{ literal: clean(body.translator) }] : undefined,
      "container-title": clean(body.containerTitle) || undefined,
      publisher: clean(body.publisher) || undefined,
      "publisher-place": clean(body.place) || undefined,
      volume: clean(body.volume) || undefined,
      edition: clean(body.edition) || undefined,
      issued: clean(body.year) ? { "date-parts": [[clean(body.year)]] } : undefined
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid CSL source record." }, { status: 400 });
  }

  const source = await prisma.source.update({
    where: { id: sourceId },
    data: {
      shortTitle: normalized.title,
      cslJson: cslToInputJson(normalized)
    }
  });

  return NextResponse.json({ source });
}
