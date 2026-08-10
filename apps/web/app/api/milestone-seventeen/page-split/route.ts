import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { readStoredPdfFile, storePdfFile } from "../../../../lib/server-storage";
import { splitTwoPageSpreadPdf } from "../../../../lib/pdf-page-splitter";
import { getJob, isJobRunning, setFinishedJob, setRunningJob } from "../../../../lib/page-split-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same shape and reasoning as milestone-sixteen/ocr-status: page-splitting
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
    include: { document: true },
    orderBy: { createdAt: "desc" }
  });

  const results = await Promise.all(
    versions.map(async (version) => {
      const job = await getJob(version.id);
      return {
        versionId: version.id,
        documentId: version.documentId,
        documentTitle: version.document.title,
        hasStoredPdf: Boolean(version.snapshotKey),
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

  if (isJobRunning(versionId)) {
    return NextResponse.json({ splitStarted: true, alreadyRunning: true, versionId }, { status: 202 });
  }

  const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
  if (!version) {
    return NextResponse.json({ error: "No document version found for that id." }, { status: 404 });
  }
  if (!version.snapshotKey) {
    return NextResponse.json(
      { error: "No server-stored PDF file is available for this version, so there's nothing to split." },
      { status: 422 }
    );
  }

  setRunningJob(versionId, null);

  runSplitInBackground(versionId, version.snapshotKey, version.documentId).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`Background page-split failed for version ${versionId}:`, error);
  });

  return NextResponse.json({ splitStarted: true, versionId }, { status: 202 });
}

async function runSplitInBackground(versionId: string, snapshotKey: string, documentId: string) {
  try {
    const pdfBytes = await readStoredPdfFile(snapshotKey);
    const result = await splitTwoPageSpreadPdf(pdfBytes, (completed, total) => {
      setRunningJob(versionId, { completed, total });
    });

    // Stored under the same document's folder as a distinct file (not
    // overwriting the original snapshot, and not creating a new Document
    // row on its own) - storePdfFile expects a browser-shaped File, which
    // Node provides as a global since v20.
    const resultFile = new File([result.pdfBytes as BlobPart], "split-two-page-spreads.pdf", { type: "application/pdf" });
    const stored = await storePdfFile(`${documentId}/page-split`, resultFile);

    await setFinishedJob(versionId, {
      status: "ready",
      progress: null,
      resultStorageKey: stored.storageKey,
      originalPageCount: result.originalPageCount,
      newPageCount: result.newPageCount,
      splitOriginalPageNumbers: result.splitOriginalPageNumbers
    });
  } catch (error) {
    await setFinishedJob(versionId, {
      status: "failed",
      progress: null,
      error: error instanceof Error ? error.message : "Page split failed."
    });
    throw error;
  }
}
