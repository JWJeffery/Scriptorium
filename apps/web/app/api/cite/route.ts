import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { fail, readJsonObject, text } from "../../../lib/api-helpers";
import { formatCitations, isStyleKey, missingCitationFields, type CiteInput } from "../../../lib/csl-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Format citations with the official CSL style files.
//   { style, mode: "each" | "sequence", items: [{ sourceId | csl, locator?, label? }] }
// "each" formats every item as a stand-alone first citation; "sequence" treats the
// items as consecutive notes, so a repeat reference is shortened.
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  if (!isStyleKey(body.style)) return fail("Unknown citation style.");
  if (!Array.isArray(body.items) || body.items.length === 0) return fail("items is required.");
  if (body.items.length > 500) return fail("Too many items.");

  const sourceIds = Array.from(new Set(body.items.map((item) => text((item as { sourceId?: unknown }).sourceId)).filter(Boolean)));
  const sources = sourceIds.length ? await prisma.source.findMany({ where: { id: { in: sourceIds } }, select: { id: true, cslJson: true } }) : [];
  const sourceById = new Map(sources.map((source) => [source.id, source.cslJson]));

  const inputs: CiteInput[] = [];
  let index = 0;
  for (const raw of body.items) {
    const item = (typeof raw === "object" && raw !== null ? raw : {}) as { sourceId?: unknown; csl?: unknown; locator?: unknown; label?: unknown };
    const sourceId = text(item.sourceId);
    const csl = sourceId ? sourceById.get(sourceId) : item.csl;
    if (csl === undefined) return fail(sourceId ? "A source could not be found." : "Each item needs a sourceId or csl.", sourceId ? 404 : 400);
    inputs.push({ key: sourceId || `inline-${index}`, csl, locator: text(item.locator, 64) || undefined, label: text(item.label, 32) || undefined });
    index += 1;
  }

  const results = formatCitations(body.style, inputs, body.mode === "sequence" ? "sequence" : "each");
  return NextResponse.json({ citations: results, missing: missingCitationFields(inputs[0].csl) });
}
