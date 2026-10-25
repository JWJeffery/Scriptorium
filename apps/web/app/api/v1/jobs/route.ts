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
  return NextResponse.json({ jobs: rows.map(summarizeJob) });
});
