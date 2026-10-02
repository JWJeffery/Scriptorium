import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { fail, readJsonObject, text } from "../../../lib/api-helpers";
import { ensureModel, modelStatus } from "../../../lib/embeddings";
import { indexDocument, indexProgress, indexStatus, removeIndex } from "../../../lib/meaning-index";
import { releaseHeavyJob, tryAcquireHeavyJob } from "../../../lib/heavy-job-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The by-meaning index: what is indexed, and starting/removing an index.
export async function GET() {
  return NextResponse.json({ model: await modelStatus(), documents: await indexStatus() });
}

// Build or update one book's index in the background. The first ever build also
// downloads the 23 MB model.
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const documentId = text(body.documentId);
  if (!documentId) return fail("documentId is required.");
  if (!(await prisma.document.findUnique({ where: { id: documentId }, select: { id: true } }))) return fail("Document not found.", 404);

  const slot = tryAcquireHeavyJob("index", documentId);
  if (!slot.acquired) return fail("Another long job (OCR, page split, backup or indexing) is running. Try again when it has finished.", 429);

  indexProgress.set(documentId, { documentId, done: 0, total: 0, state: "running" });
  (async () => {
    try {
      await ensureModel();
      await indexDocument(documentId);
    } catch (error) {
      console.error(`Indexing ${documentId} failed:`, error);
      indexProgress.set(documentId, { documentId, done: 0, total: 0, state: "failed", error: error instanceof Error ? error.message : "Indexing failed." });
    } finally {
      releaseHeavyJob("index", documentId);
    }
  })();
  return NextResponse.json({ started: true, documentId }, { status: 202 });
}

export async function DELETE(request: NextRequest) {
  const documentId = text(request.nextUrl.searchParams.get("documentId"));
  if (!documentId) return fail("documentId is required.");
  return NextResponse.json({ removed: await removeIndex(documentId) });
}
