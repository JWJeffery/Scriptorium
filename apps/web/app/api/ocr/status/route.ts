import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { detectLikelyScanned } from "../../../../lib/ocr-provider";
import { OCR_RUNNING_STATE } from "../../../../lib/jobs/handlers";
import { latestJobsFor } from "../../../../lib/jobs/jobs";
import { enqueueHeavyJob } from "../../../../lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNING_STATE = OCR_RUNNING_STATE;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function ocrWarningsFromAnchor(anchor: unknown): string[] {
  if (typeof anchor !== "object" || anchor === null || !("ocrWarnings" in anchor)) return [];
  const warnings = (anchor as { ocrWarnings?: unknown }).ocrWarnings;
  return Array.isArray(warnings) ? warnings.filter((warning): warning is string => typeof warning === "string") : [];
}

export async function GET(request: NextRequest) {
  const documentId = clean(request.nextUrl.searchParams.get("documentId"));

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: documentId || undefined, document: { kind: "PDF" } },
    include: { pages: true, textSpans: true, document: true },
    orderBy: { createdAt: "desc" }
  });

  const jobs = await latestJobsFor("ocr", versions.map((version) => version.id));
  const results = versions.map((version) => {
    const extractedTextLength = version.textSpans.reduce((sum, span) => sum + span.text.length, 0);
    // Real page count comes from the per-page TextSpans that ingestion (and
    // OCR) create - one row per PDF page. Falls back to the PageMap count
    // (historically just 1, the page registered at ingest time) for
    // documents registered before that existed.
    const pageCount = version.textSpans.length || version.pages.length || 1;
    const detection = detectLikelyScanned({ extractedTextLength, pageCount });
    const ocrRunning = version.extractionState === RUNNING_STATE;
    const ocrWarnings = Array.from(new Set(version.textSpans.flatMap((span) => ocrWarningsFromAnchor(span.anchor))));

    return {
      versionId: version.id,
      documentId: version.documentId,
      documentTitle: version.document.title,
      extractionState: version.extractionState,
      ocrRunning,
      ocrProgress: ocrRunning && jobs.get(version.id)?.progressTotal ? { completed: jobs.get(version.id)!.progressDone, total: jobs.get(version.id)!.progressTotal } : null,
      ocrWarnings,
      pageCount,
      extractedTextLength,
      ...detection
    };
  });

  return NextResponse.json({
    count: results.length,
    likelyScannedCount: results.filter((r) => r.likelyScanned).length,
    results
  });
}

// OCR (page rendering + Tesseract recognition, plus a first-run language-data download) can easily take
// longer than a reverse proxy's request timeout, so this route never does OCR itself: it queues a job and
// returns at once. A worker picks the job up (one heavy job at a time, retried once if it dies), and the
// panel polls GET above until extractionState moves off "-running". The first thing the worker does is
// keep that state; here we set it immediately so the panel shows "running" even while the job waits.
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { versionId?: string };
  const versionId = clean(body.versionId);

  if (!versionId) {
    return NextResponse.json({ error: "versionId is required." }, { status: 400 });
  }

  const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
  if (!version) {
    return NextResponse.json({ error: "No document version found for that id." }, { status: 404 });
  }
  if (!version.snapshotKey) {
    return NextResponse.json(
      { error: "No server-stored PDF file is available for this version, so there's nothing to OCR." },
      { status: 422 }
    );
  }

  await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: RUNNING_STATE } });
  try {
    const { job } = await enqueueHeavyJob("ocr", versionId);
    return NextResponse.json({ ocrStarted: true, versionId, extractionState: RUNNING_STATE, jobId: job.id }, { status: 202 });
  } catch (error) {
    // Could not queue it: put the previous state back rather than leave the book "running" forever.
    await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: version.extractionState } }).catch(() => undefined);
    throw error;
  }
}
