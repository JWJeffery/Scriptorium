import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { SPLIT_OUTPUT_FILENAME } from "../../../lib/jobs/handlers";
import { enqueueHeavyJob } from "../../../lib/jobs/queue";
import { getJobs } from "../../../lib/page-split-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same shape and reasoning as ocr/status: page-splitting
// a real book-length PDF (one render per page, each in its own process -
// see pdf-page-splitter.ts) routinely takes well over a minute, longer
// than a reverse proxy's request timeout tends to allow. So this route
// doesn't split inline either: it marks the version as running, kicks the
// real work off in the background without awaiting it, and returns
// immediately. The panel polls GET below until the state moves off
// "running".
//
// Job status is read through page-split-jobs.ts's getJob/setFinishedJob,
// not a raw in-memory Map directly - the finished (ready/failed) state is
// also persisted to disk there, because relying on memory alone turned
// out to lose real completed jobs across a Next.js dev-mode module
// reload. See that file for the full story.

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  const documentId = clean(request.nextUrl.searchParams.get("documentId"));

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: documentId || undefined, document: { kind: "PDF" } },
    include: { document: true, _count: { select: { textSpans: true } } },
    orderBy: { createdAt: "desc" }
  });

  const jobs = await getJobs(versions.map((version) => version.id));
  const results = await Promise.all(
    versions.map(async (version) => {
      const job = jobs.get(version.id);
      const alreadySplit = version.document.originalFilename === SPLIT_OUTPUT_FILENAME;
      return {
        versionId: version.id,
        documentId: version.documentId,
        documentTitle: version.document.title,
        hasStoredPdf: Boolean(version.snapshotKey),
        alreadySplit,
        pageCount: version._count.textSpans || null,
        splitRunning: job?.status === "running",
        splitReady: job?.status === "ready",
        splitFailed: job?.status === "failed",
        splitError: job?.error ?? null,
        splitProgress: job?.status === "running" ? job.progress : null,
        splitSummary:
          job?.status === "ready"
            ? {
                originalPageCount: job.originalPageCount,
                newPageCount: job.newPageCount,
                splitOriginalPageNumbers: job.splitOriginalPageNumbers
              }
            : null
      };
    })
  );

  return NextResponse.json({ count: results.length, results });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { versionId?: string };
  const versionId = clean(body.versionId);

  if (!versionId) {
    return NextResponse.json({ error: "versionId is required." }, { status: 400 });
  }

  const version = await prisma.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
  if (!version) {
    return NextResponse.json({ error: "No document version found for that id." }, { status: 404 });
  }
  if (!version.snapshotKey) {
    return NextResponse.json(
      { error: "No server-stored PDF file is available for this version, so there's nothing to split." },
      { status: 422 }
    );
  }
  if (version.document.originalFilename === SPLIT_OUTPUT_FILENAME) {
    return NextResponse.json(
      { error: "This document is already a split, single-page PDF and cannot be split again." },
      { status: 409 }
    );
  }

  // Queued, then worked one heavy job at a time. Asking again while it is queued or running is harmless.
  const { job, alreadyActive } = await enqueueHeavyJob("page-split", versionId);
  return NextResponse.json({ splitStarted: true, ...(alreadyActive ? { alreadyRunning: true } : {}), versionId, jobId: job.id }, { status: 202 });
}
