import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { detectLikelyScanned } from "../../../../lib/ocr-provider";
import { tesseractOcrProvider } from "../../../../lib/tesseract-ocr-provider";
import { readStoredPdfFile } from "../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNING_STATE = "tesseract-js-eng-v1-running";
const FAILED_STATE = "tesseract-js-eng-v1-failed";
const NO_TEXT_STATE = "tesseract-js-eng-v1-no-text";
const TIMEOUT_STATE = "tesseract-js-eng-v1-timed-out";
// Generous, but bounded: this exists specifically so a hung language-data
// download or a stalled recognition step can't leave a version stuck in
// "-running" forever with no way to tell the difference between "slow" and
// "dead" from the outside.
const BACKGROUND_TIMEOUT_MS = 3 * 60 * 1000;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  const documentId = clean(request.nextUrl.searchParams.get("documentId"));

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: documentId || undefined, document: { kind: "PDF" } },
    include: { pages: true, textSpans: true, document: true },
    orderBy: { createdAt: "desc" }
  });

  const results = versions.map((version) => {
    const extractedTextLength = version.textSpans.reduce((sum, span) => sum + span.text.length, 0);
    // Real page count comes from the per-page TextSpans that ingestion (and
    // OCR) create - one row per PDF page. Falls back to the PageMap count
    // (historically just 1, the page registered at ingest time) for
    // documents registered before that existed.
    const pageCount = version.textSpans.length || version.pages.length || 1;
    const detection = detectLikelyScanned({ extractedTextLength, pageCount });

    return {
      versionId: version.id,
      documentId: version.documentId,
      documentTitle: version.document.title,
      extractionState: version.extractionState,
      ocrRunning: version.extractionState === RUNNING_STATE,
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

// OCR (page rendering + Tesseract recognition, plus a first-run language-data
// download) can easily take longer than a reverse proxy's request timeout -
// this is exactly what caused 504 Gateway Timeout errors in a GitHub
// Codespace even though the work itself was completing fine. So this route
// no longer does OCR inline: it marks the version as running, kicks the real
// work off in the background without awaiting it, and returns immediately.
// The panel polls GET above until extractionState moves off "-running".
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

  runOcrInBackground(versionId, version.snapshotKey).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`Background OCR failed for version ${versionId}:`, error);
  });

  return NextResponse.json({ ocrStarted: true, versionId, extractionState: RUNNING_STATE }, { status: 202 });
}

async function runOcrInBackground(versionId: string, snapshotKey: string) {
  try {
    const pdfBytes = await readStoredPdfFile(snapshotKey);
    const extractPromise = tesseractOcrProvider.extractText({ pdfBytes, documentId: versionId });
    // Promise.race doesn't cancel extractPromise - if it settles after the
    // timeout has already fired below, this prevents an unhandled
    // rejection (which can crash the whole Node process on a later
    // failure) from an orphaned promise nobody else is watching.
    extractPromise.catch(() => {});

    const result = await Promise.race([
      extractPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("OCR timed out")), BACKGROUND_TIMEOUT_MS);
      })
    ]);

    if (result.pages && result.pages.length > 0) {
      // OCR results replace whatever TextSpans this version had (from
      // ingestion's empty-text spans on a real scan). This intentionally
      // loses the one pageMapId link ingestion set on the registered page -
      // that link isn't used for anything OCR-relevant.
      await prisma.$transaction([
        prisma.textSpan.deleteMany({ where: { versionId } }),
        prisma.textSpan.createMany({
          data: result.pages.map((page) => ({
            versionId,
            text: page.text,
            anchor: { pdfPageIndex: page.pageIndex, ocr: true, confidence: page.confidence, words: page.words }
          }))
        }),
        prisma.documentVersion.update({
          where: { id: versionId },
          data: { extractionState: tesseractOcrProvider.name }
        })
      ]);
    } else {
      await prisma.documentVersion.update({ where: { id: versionId }, data: { extractionState: NO_TEXT_STATE } });
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "OCR timed out";
    await prisma.documentVersion
      .update({ where: { id: versionId }, data: { extractionState: timedOut ? TIMEOUT_STATE : FAILED_STATE } })
      .catch(() => {});
    throw error;
  }
}
