import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { fail, readJsonObject, text } from "../../../lib/api-helpers";
import { NUMBERING_SYSTEMS, validateRanges, type NumberingSystem, type PageRangeSpec } from "../../../lib/page-labels";
import { loadRanges } from "../../../lib/page-ranges-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the numbering of this version currently is. A version that has never had
// ranges saved reports the single range implied by its original mapping rule.
export async function GET(request: NextRequest) {
  const versionId = text(request.nextUrl.searchParams.get("versionId"));
  if (!versionId) return fail("versionId is required.");
  const result = await loadRanges(versionId);
  return result ? NextResponse.json(result) : fail("Document version not found.", 404);
}

// Replace all of a version's ranges. An empty list clears them, which returns
// the version to its original single rule.
export async function PUT(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const versionId = text(body.versionId);
  if (!versionId || !Array.isArray(body.ranges)) return fail("versionId and ranges are required.");
  if (body.ranges.length > 60) return fail("Too many ranges.");
  if (!(await prisma.documentVersion.findUnique({ where: { id: versionId }, select: { id: true } }))) return fail("Document version not found.", 404);

  const ranges: PageRangeSpec[] = body.ranges.map((raw) => {
    const row = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      startPdfPage: Number(row.startPdfPage),
      endPdfPage: row.endPdfPage === null || row.endPdfPage === undefined || row.endPdfPage === "" ? null : Number(row.endPdfPage),
      system: (NUMBERING_SYSTEMS.some((system) => system.value === row.system) ? row.system : "invalid") as NumberingSystem,
      startValue: Number(row.system === "unnumbered" ? 1 : row.startValue),
      prefix: text(row.prefix, 16)
    };
  });
  const problem = validateRanges(ranges);
  if (problem) return fail(problem);

  await prisma.$transaction([
    prisma.pageRange.deleteMany({ where: { versionId } }),
    prisma.pageRange.createMany({ data: ranges.map((range) => ({ versionId, ...range })) })
  ]);
  return NextResponse.json(await loadRanges(versionId));
}
