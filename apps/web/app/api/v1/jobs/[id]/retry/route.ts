import { NextResponse } from "next/server";
import { conflict, notFound, route } from "../../../../../../lib/api-v1";
import { summarizeJob, type JobType } from "../../../../../../lib/jobs/jobs";
import { enqueueHeavyJob } from "../../../../../../lib/jobs/queue";
import { prisma } from "../../../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Run a failed job again as a new job (the failed record is kept as history).
export const POST = route<{ params: Promise<{ id: string }> }>(async (_request, context) => {
  const row = await prisma.processingJob.findUnique({ where: { id: (await context.params).id } });
  if (!row) throw notFound("That job");
  if (row.state !== "FAILED") throw conflict("Only a failed job can be retried.");
  const { job } = await enqueueHeavyJob(row.type as JobType, row.subjectId);
  return NextResponse.json(summarizeJob(job), { status: 202 });
});
