"use client";

import { useEffect, useRef, useState } from "react";





import { type CurrentDocumentRef } from "../lib/tools-shared";

type OcrResult = {
  versionId: string;
  documentId: string;
  documentTitle: string;
  extractionState: string;
  ocrRunning: boolean;
  ocrProgress: { completed: number; total: number } | null;
  ocrWarnings: string[];
  pageCount: number;
  extractedTextLength: number;
  likelyScanned: boolean;
  charsPerPage: number;
  reason: string;
};

export function OcrStatusSection({
  currentRef,
  pendingOcrVersionId,
  onOcrReady
}: {
  currentRef: CurrentDocumentRef;
  pendingOcrVersionId?: string;
  onOcrReady: () => void;
}) {
  const [documentId, setDocumentId] = useState(currentRef.documentId ?? "");
  const [results, setResults] = useState<OcrResult[]>([]);
  const [status, setStatus] = useState("Checks PDF versions for a likely missing text layer. Leave the id blank to check every PDF.");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [etaText, setEtaText] = useState<string | null>(null);
  // Anchors the rate calculation to "time and page count when we first
  // observed this run in progress" rather than needing a true server-side
  // start timestamp - works identically whether this session started the
  // OCR run itself or found one already running via "Check for scanned
  // pages" and is just resuming progress checks on it. Reset whenever the
  // completed count goes backwards (a new run started).
  const rateAnchorRef = useRef<{ time: number; completed: number } | null>(null);

  useEffect(() => {
    if (currentRef.documentId) setDocumentId(currentRef.documentId);
  }, [currentRef.documentId]);

  function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  function updateEta(progress: { completed: number; total: number }) {
    const anchor = rateAnchorRef.current;
    if (!anchor || progress.completed < anchor.completed) {
      // First observation of this run, or the count went backwards
      // (a new run started) - reset the anchor and don't show a number
      // yet, since a rate needs at least one interval to be honest rather
      // than a guess.
      rateAnchorRef.current = { time: Date.now(), completed: progress.completed };
      setEtaText(null);
      return;
    }
    const pagesDoneSinceAnchor = progress.completed - anchor.completed;
    if (pagesDoneSinceAnchor <= 0) {
      // Still on the same page count as the anchor - not enough data yet
      // for an honest rate. Leave whatever estimate is already showing
      // rather than flickering to nothing between polls.
      return;
    }
    const elapsedMs = Date.now() - anchor.time;
    const msPerPage = elapsedMs / pagesDoneSinceAnchor;
    const remainingPages = progress.total - progress.completed;
    if (remainingPages <= 0) {
      setEtaText(null);
      return;
    }
    setEtaText(`~${formatDuration(msPerPage * remainingPages)} remaining`);
  }

  async function lookUp() {
    setStatus("Checking for scanned pages...");
    try {
      const query = documentId.trim() ? `?documentId=${encodeURIComponent(documentId.trim())}` : "";
      const response = await fetch(`/api/ocr/status${query}`);
      const body = (await response.json()) as { count?: number; likelyScannedCount?: number; results?: OcrResult[]; error?: string };
      if (!response.ok) {
        setStatus(body.error ?? "Lookup failed.");
        setResults([]);
        return;
      }
      setResults(body.results ?? []);
      const pendingResult = pendingOcrVersionId ? body.results?.find((result) => result.versionId === pendingOcrVersionId) : undefined;
      const running = body.results?.find((result) => result.ocrRunning);
      if (running) {
        setStatus(`${body.count ?? 0} PDF version(s) checked, ${body.likelyScannedCount ?? 0} likely scanned. OCR is already running on "${running.documentTitle}" - resuming progress checks...`);
        setBusyId(running.versionId);
        rateAnchorRef.current = null;
        await pollUntilDone(running.versionId);
        return;
      }
      if (pendingResult?.extractionState === "tesseract-js-eng-v1") {
        onOcrReady();
        setStatus(`OCR is already complete for "${pendingResult.documentTitle}". Its searchable PDF is ready to download.`);
        return;
      }
      if (pendingResult?.likelyScanned) {
        setStatus(
          `"${pendingResult.documentTitle}" is the newly split image-only copy. Zero extracted words is expected before OCR; click Attempt OCR now.`
        );
        return;
      }
      setStatus(`${body.count ?? 0} PDF version(s) checked, ${body.likelyScannedCount ?? 0} likely scanned.`);
    } catch {
      setStatus("Lookup failed - the server did not respond.");
    }
  }

  async function attemptOcr(versionId: string) {
    setBusyId(versionId);
    rateAnchorRef.current = null;
    setEtaText(null);
    try {
      const response = await fetch("/api/ocr/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId })
      });
      const body = (await response.json()) as { ocrStarted?: boolean; error?: string };
      if (response.status === 501) {
        setStatus(body.error ?? "No OCR provider is configured yet. This confirms the detection pipeline works; a real OCR engine plugs in here later.");
        setBusyId(null);
        return;
      }
      if (!response.ok || !body.ocrStarted) {
        setStatus(body.error ?? "OCR attempt failed.");
        setBusyId(null);
        return;
      }
      setStatus("OCR started. This can take a while - rendering the page, running recognition, and (the first time only) downloading language data. Checking progress...");
      await pollUntilDone(versionId);
    } catch {
      setStatus("OCR attempt failed - the server did not respond.");
      setBusyId(null);
    }
  }

  async function pollUntilDone(versionId: string, attempt = 0) {
    const MAX_ATTEMPTS = 195; // ~13 minutes at 4s apart - a little past the server's 12-minute bound, so the client doesn't give up first
    try {
      const query = documentId.trim() ? `?documentId=${encodeURIComponent(documentId.trim())}` : "";
      const response = await fetch(`/api/ocr/status${query}`);
      const body = (await response.json()) as { results?: OcrResult[] };
      const match = body.results?.find((result) => result.versionId === versionId);
      setResults(body.results ?? []);

      if (match?.ocrRunning) {
        if (attempt >= MAX_ATTEMPTS) {
          setStatus("OCR is still running after a while - it hasn't failed, just taking longer than expected. Click \"Check for scanned pages\" again in a bit to see if it finished.");
          setBusyId(null);
          return;
        }
        if (match.ocrProgress && match.ocrProgress.total > 0) {
          updateEta(match.ocrProgress);
          const percent = Math.round((match.ocrProgress.completed / match.ocrProgress.total) * 100);
          setStatus(`OCR running: page ${match.ocrProgress.completed} of ${match.ocrProgress.total} (${percent}%)...`);
        } else {
          setStatus("OCR starting up - rendering the first page and (on a first run) downloading language data...");
        }
        setTimeout(() => {
          pollUntilDone(versionId, attempt + 1);
        }, 4000);
        return;
      }

      setEtaText(null);
      rateAnchorRef.current = null;
      if (match?.extractionState === "tesseract-js-eng-v1-timed-out") {
        setStatus("OCR timed out - most likely the language-data download stalled. You can try again; it should be faster now that a partial download may already be cached.");
      } else if (match?.extractionState === "tesseract-js-eng-v1-failed") {
        setStatus("OCR failed. Check the server terminal for the actual error.");
      } else if (match && !match.likelyScanned) {
        if (match.versionId === pendingOcrVersionId) onOcrReady();
        setStatus(
          `OCR complete. ${match.extractedTextLength} character(s) recognized. You can now download a searchable PDF.${match.ocrWarnings.length ? ` ${match.ocrWarnings.length} quality warning(s) need review.` : ""}`
        );
      } else {
        setStatus("OCR finished running, but the page still doesn't have a usable text layer - it may be a poor-quality scan.");
      }
      setBusyId(null);
    } catch {
      setStatus("Lost track of OCR progress - the server did not respond. Click \"Check for scanned pages\" to see the current state.");
      setBusyId(null);
    }
  }

  return (
    <div className="toolsFormLayout">
      <div className="toolsForm">
        <label>
          Document id (optional)
          <input value={documentId} onChange={(event) => setDocumentId(event.target.value)} placeholder="Leave blank to check every PDF" />
        </label>
        <button className="primaryButton" type="button" onClick={lookUp}>
          Check for scanned pages
        </button>
        <p className="statusLine toolsStatusLine">{status}</p>
      </div>
      <div className="toolsResultsStack">
        {results.length === 0 ? (
          <p className="emptyAnnotationState">No versions checked yet.</p>
        ) : (
          results.map((result) => (
            <article className="toolsResultRow" key={result.versionId}>
              <div className="toolsResultRowHeader">
                {result.ocrRunning ? (
                  <span className="toolsBadge toolsBadgeStale">Running OCR&hellip;</span>
                ) : (
                  <span className={result.likelyScanned ? "toolsBadge toolsBadgeStale" : "toolsBadge toolsBadgeFresh"}>
                    {result.likelyScanned ? "Likely scanned" : "Text layer present"}
                  </span>
                )}
                <strong>{result.documentTitle}</strong>
              </div>
              <p>{result.reason}</p>
              <small>
                {result.pageCount} page(s) &middot; {result.extractedTextLength} extracted character(s) &middot; extraction state {result.extractionState}
              </small>
              {result.ocrWarnings.length > 0 ? (
                <ul className="toolsWarnings" aria-label="OCR quality warnings">
                  {result.ocrWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {result.ocrRunning && result.ocrProgress && result.ocrProgress.total > 0 ? (
                <div>
                  <div
                    className="toolsProgressTrack"
                    role="progressbar"
                    aria-valuenow={result.ocrProgress.completed}
                    aria-valuemin={0}
                    aria-valuemax={result.ocrProgress.total}
                  >
                    <div
                      className="toolsProgressFill"
                      style={{ width: `${Math.round((result.ocrProgress.completed / result.ocrProgress.total) * 100)}%` }}
                    />
                  </div>
                  <span className="toolsProgressLabel">
                    {result.ocrProgress.completed} / {result.ocrProgress.total} pages (
                    {Math.round((result.ocrProgress.completed / result.ocrProgress.total) * 100)}%)
                    {result.versionId === busyId && etaText ? ` \u00b7 ${etaText}` : ""}
                  </span>
                </div>
              ) : null}
              <div className="toolsResultRowActions">
                <button
                  className="secondaryButton"
                  type="button"
                  disabled={busyId === result.versionId || result.ocrRunning}
                  onClick={() => attemptOcr(result.versionId)}
                >
                  {result.ocrRunning
                    ? "Running\u2026"
                    : result.extractionState === "tesseract-js-eng-v1"
                      ? "Re-run OCR"
                      : "Attempt OCR"}
                </button>
                {result.extractionState === "tesseract-js-eng-v1" && !result.ocrRunning ? (
                  <>
                    <a
                      className="primaryButton"
                      href={`/api/ocr/searchable-pdf?versionId=${encodeURIComponent(result.versionId)}`}
                      download
                    >
                      Download searchable PDF
                    </a>
                    <small className="toolsHint">
                      OCR is complete. Re-run only if you need to regenerate it after an OCR pipeline update.
                    </small>
                  </>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split two-page spreads (apps/web/lib/pdf-page-splitter.ts) - a real,
// separate physical-page split for scanned book-spread PDFs, not to be
// confused with the gutter-split OCR already does internally. That one
// only changes what OCR sees; this one produces an
// actual new PDF where each spread becomes two real, individually-
// navigable pages. See RESUME_PROJECT_NOTE.md for the full history of
// getting the detection itself right - this section is just the first
// screen for a tool that, until now, only existed as a CLI script.
//
// Deliberately does NOT overwrite the original document or its existing
// page-map/annotations - same reasoning pdf-page-splitter.ts has stated
// from the start. The split result is a reviewable, downloadable
// artifact; only an explicit "Create as new document" click (which
// reuses the exact same upload endpoint a person would hit re-uploading
// the CLI tool's output by hand) makes anything durable.
// ---------------------------------------------------------------------------

