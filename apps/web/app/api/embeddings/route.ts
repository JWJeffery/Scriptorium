import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { fail, readJsonObject, text } from "../../../lib/api-helpers";
import { modelStatus } from "../../../lib/embeddings";
import { indexStatus, removeIndex } from "../../../lib/meaning-index";
import { enqueueHeavyJob } from "../../../lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The by-meaning index: what is indexed, and starting/removing an index.
export async function GET() {
  return NextResponse.json({ model: await modelStatus(), documents: await indexStatus() });
}

// Build or update one book's index in the background (the first ever build also downloads the 23 MB
// model). The work is queued and runs one job at a time; progress is read from GET above.
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const documentId = text(body.documentId);
  if (!documentId) return fail("documentId is required.");
  if (!(await prisma.document.findUnique({ where: { id: documentId }, select: { id: true } }))) return fail("Document not found.", 404);

  const { job, alreadyActive } = await enqueueHeavyJob("embed-index", documentId);
  return NextResponse.json({ started: true, alreadyRunning: alreadyActive, documentId, jobId: job.id }, { status: 202 });
}

export async function DELETE(request: NextRequest) {
  const documentId = text(request.nextUrl.searchParams.get("documentId"));
  if (!documentId) return fail("documentId is required.");
  return NextResponse.json({ removed: await removeIndex(documentId) });
}
