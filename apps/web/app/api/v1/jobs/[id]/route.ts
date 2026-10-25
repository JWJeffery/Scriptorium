import { NextResponse } from "next/server";
import { notFound, route } from "../../../../../lib/api-v1";
import { summarizeJob } from "../../../../../lib/jobs/jobs";
import { prisma } from "../../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_request, context) => {
  const row = await prisma.processingJob.findUnique({ where: { id: (await context.params).id } });
  if (!row) throw notFound("That job");
  return NextResponse.json(summarizeJob(row));
});
