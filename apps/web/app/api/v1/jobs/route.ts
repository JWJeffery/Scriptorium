import { NextResponse } from "next/server";
import { parseQuery, route, z } from "../../../../lib/api-v1";
import { JOB_TYPES, summarizeJob } from "../../../../lib/jobs/jobs";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(JOB_TYPES as [string, ...string[]]).optional(),
  state: z.enum(["queued", "running", "complete", "failed"]).optional(),
  subjectId: z.string().max(191).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

// The processing queue as the user sees it: what is waiting, running, finished, or failed.
export const GET = route(async (request) => {
  const query = parseQuery(request, querySchema);
  const rows = await prisma.processingJob.findMany({
    where: { ...(query.type ? { type: query.type } : {}), ...(query.state ? { state: query.state.toUpperCase() as "QUEUED" } : {}), ...(query.subjectId ? { subjectId: query.subjectId } : {}) },
    orderBy: { createdAt: "desc" },
    take: query.limit
  });
  // Which book is each job about? OCR and page splitting work on a version; indexing works on the book itself.
  const versionIds = rows.filter((row) => row.type !== "embed-index").map((row) => row.subjectId);
  const versions = versionIds.length ? await prisma.documentVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, documentId: true } }) : [];
  const itemIdByVersion = new Map(versions.map((version) => [version.id, version.documentId]));
  const itemIds = Array.from(new Set(rows.map((row) => (row.type === "embed-index" ? row.subjectId : itemIdByVersion.get(row.subjectId))).filter((id): id is string => Boolean(id))));
  const items = itemIds.length ? await prisma.document.findMany({ where: { id: { in: itemIds } }, select: { id: true, title: true } }) : [];
  const titleById = new Map(items.map((item) => [item.id, item.title]));
  return NextResponse.json({
    jobs: rows.map((row) => {
      const itemId = row.type === "embed-index" ? row.subjectId : itemIdByVersion.get(row.subjectId) ?? null;
      return { ...summarizeJob(row), itemId, itemTitle: itemId ? titleById.get(itemId) ?? null : null };
    })
  });
});
