import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { fail, readJsonObject, text } from "../../../../lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Replace a source's bibliographic record with a looked-up or imported one.
// { sourceId, csl }
export async function PUT(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const sourceId = text(body.sourceId);
  const csl = body.csl;
  if (!sourceId || typeof csl !== "object" || csl === null || Array.isArray(csl)) return fail("sourceId and csl are required.");
  const record = { ...(csl as Record<string, unknown>) };
  delete record.id;
  if (typeof record.title !== "string" || !record.title.trim()) return fail("The record needs a title.");
  if (JSON.stringify(record).length > 100_000) return fail("That record is too large.", 413);
  if (!(await prisma.source.findUnique({ where: { id: sourceId }, select: { id: true } }))) return fail("Source not found.", 404);

  const source = await prisma.source.update({
    where: { id: sourceId },
    data: { shortTitle: record.title.trim().slice(0, 512), cslJson: JSON.parse(JSON.stringify(record)) as Prisma.InputJsonObject }
  });
  return NextResponse.json({ source });
}
