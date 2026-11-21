import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseBody, route } from "../../../../../../lib/api-v1";
import { MAX_LEGEND_LABEL, highlightColors, parseLegend } from "../../../../../../lib/highlights";
import { prisma } from "../../../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const customKeys = highlightColors.filter((color) => color.custom).map((color) => color.key);
const legendSchema = z.object({
  legend: z.record(z.string(), z.string().max(MAX_LEGEND_LABEL)).refine((entries) => Object.keys(entries).every((key) => customKeys.includes(key)), "Only the custom colours can be named.")
});

export const GET = route<{ params: Promise<{ id: string }> }>(async (_request, context) => {
  const found = await prisma.document.findFirst({ where: { id: (await context.params).id, deletedAt: null }, select: { highlightLegend: true } });
  if (!found) throw notFound();
  return NextResponse.json({ legend: parseLegend(found.highlightLegend) });
});

export const PUT = route<{ params: Promise<{ id: string }> }>(async (request, context) => {
  const { legend } = await parseBody(request, legendSchema);
  const cleaned = parseLegend(JSON.stringify(legend));
  const updated = await prisma.document.updateMany({
    where: { id: (await context.params).id, deletedAt: null },
    data: { highlightLegend: Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null }
  });
  if (updated.count === 0) throw notFound();
  return NextResponse.json({ legend: cleaned });
});
