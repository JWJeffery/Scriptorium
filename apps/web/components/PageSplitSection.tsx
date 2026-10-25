"use client";

import { useEffect, useRef, useState } from "react";





import { DOCUMENT_KEY, PENDING_SPLIT_OCR_KEY, type CurrentDocumentRef } from "../lib/tools-shared";

type PageSplitResult = {
  versionId: string;
  documentId: string;
  documentTitle: string;
  hasStoredPdf: boolean;
  alreadySplit: boolean;
  pageCount: number | null;
  splitRunning: boolean;
  splitReady: boolean;
  splitFailed: boolean;
  splitError: string | null;
  splitProgress: { completed: number; total: number } | null;
  splitSummary: { originalPageCount: number; newPageCount: number; splitOriginalPageNumbers: number[] } | null;
};

export function PageSplitSection({ currentRef }: { currentRef: CurrentDocumentRef }) {
  const [documentId, setDocumentId] = useState(currentRef.documentId ?? "");
  const [results, setResults] = useState<PageSplitResult[]>([]);
  const [status, setStatus] = useState(
    "Physically splits a two-page-spread scan into one real page per book page. Leave the id blank to check every PDF."
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [etaText, setEtaText] = useState<string | null>(null);
  const [importBusyId, setImportBusyId] = useState<string | null>(null);
  const [importedTitle, setImportedTitle] = useState<string | null>(null);
  // Same anchoring approach as the OCR section's ETA - "time and page
  // count when this run was first observed" rather than a true
  // server-side start timestamp, so it works the same whether this
  // session started the split or is just resuming progress checks on
  // one already running.
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
      rateAnchorRef.current = { time: Date.now(), completed: progress.completed };
      setEtaText(null);
      return;
    }
    const pagesDoneSinceAnchor = progress.completed - anchor.completed;
    if (pagesDoneSinceAnchor <= 0) return;
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
    setStatus("Checking for PDFs...");
    try {
      const query = documentId.trim() ? `?documentId=${encodeURIComponent(documentId.trim())}` : "";
      const response = await fetch(`/api/page-split${query}`);
      const body = (await response.json()) as { count?: number; results?: PageSplitResult[]; error?: string };
      if (!response.ok) {
        setStatus(body.error ?? "Lookup failed.");
        setResults([]);
        return;
      }
      setResults(body.results ?? []);
      const alreadySplit = body.results?.find((result) => result.alreadySplit);
      if (alreadySplit && body.results?.length === 1) {
        setStatus(`This document is already split${alreadySplit.pageCount ? ` into ${alreadySplit.pageCount} single PDF pages` : " into single PDF pages"}. No further split is needed.`);
        return;
      }
      const running = body.results?.find((result) => result.splitRunning);
      if (running) {
        setStatus(`${body.count ?? 0} PDF version(s) checked. A split is already running on "${running.documentTitle}" - resuming progress checks...`);
        setBusyId(running.versionId);
        rateAnchorRef.current = null;
        await pollUntilDone(running.versionId);
        return;
      }
      setStatus(`${body.count ?? 0} PDF version(s) checked.`);
    } catch {
      setStatus("Lookup failed - the server did not respond.");
    }
  }

  async function startSplit(versionId: string) {
    setBusyId(versionId);
    rateAnchorRef.current = null;
    setEtaText(null);
    setImportedTitle(null);
    try {
      const response = await fetch("/api/page-split", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId })
      });
      const body = (await response.json()) as { splitStarted?: boolean; error?: string };
      if (!response.ok || !body.splitStarted) {
        setStatus(body.error ?? "Could not start the split.");
        setBusyId(null);
        return;
      }
      setStatus("Split started. This renders every page in the book, one at a time, so it can take a while for a long book. Checking progress...");
      await pollUntilDone(versionId);
    } catch {
      setStatus("Could not start the split - the server did not respond.");
      setBusyId(null);
    }
  }

  async function pollUntilDone(versionId: string, attempt = 0) {
    const MAX_ATTEMPTS = 195; // ~13 minutes at 4s apart, same bound OCR uses for the same reason
    try {
      const query = documentId.trim() ? `?documentId=${encodeURIComponent(documentId.trim())}` : "";
      const response = await fetch(`/api/page-split${query}`);
      const body = (await response.json()) as { results?: PageSplitResult[] };
      const match = body.results?.find((result) => result.versionId === versionId);
      setResults(body.results ?? []);

      if (match?.splitRunning) {
        if (attempt >= MAX_ATTEMPTS) {
          setStatus("Still running after a while - it hasn't failed, just taking longer than expected. Click \"Check for PDFs\" again in a bit.");
          setBusyId(null);
          return;
        }
        if (match.splitProgress && match.splitProgress.total > 0) {
          updateEta(match.splitProgress);
          const percent = Math.round((match.splitProgress.completed / match.splitProgress.total) * 100);
          setStatus(`Splitting: page ${match.splitProgress.completed} of ${match.splitProgress.total} (${percent}%)...`);
        } else {
          setStatus("Starting up - rendering the first page...");
        }
        setTimeout(() => {
          pollUntilDone(versionId, attempt + 1);
        }, 4000);
        return;
      }

      setEtaText(null);
      rateAnchorRef.current = null;
      if (match?.splitFailed) {
        setStatus(match.splitError ?? "The split failed. Check the server terminal for the actual error.");
      } else if (match?.splitReady && match.splitSummary) {
        const { originalPageCount, newPageCount, splitOriginalPageNumbers } = match.splitSummary;
        setStatus(
          `Done. ${splitOriginalPageNumbers.length} of ${originalPageCount} original page(s) were two-page spreads and got split into ${newPageCount} total pages.`
        );
      } else {
        setStatus("Split finished, but no result was found - try again.");
      }
      setBusyId(null);
    } catch {
      setStatus("Lost track of split progress - the server did not respond. Click \"Check for PDFs\" to see the current state.");
      setBusyId(null);
    }
  }

  async function createAsNewDocument(result: PageSplitResult) {
    const ready = window.confirm(
      "Creating and opening the split document reloads Scriptorium. Save any annotation you are currently drafting before continuing. Open the split document now?"
    );
    if (!ready) return;
    setImportBusyId(result.versionId);
    setImportedTitle(null);
    try {
      const title = `${result.documentTitle} (split)`;
      const importResponse = await fetch("/api/page-split/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: result.versionId, title })
      });
      const responseText = await importResponse.text();
      let body: {
        document?: { id: string; storageKey?: string | null };
        version?: { id: string; snapshotKey?: string | null };
        source?: { id: string };
        sourceMetadata?: { author: string; title: string; place: string; publisher: string; year: string };
        pageMap?: { id: string };
        storedFile?: { storageKey: string; size?: number };
        error?: string;
      } = {};
      try {
        body = JSON.parse(responseText) as typeof body;
      } catch {
        // Preserve a useful status below even if a proxy returns an HTML error
        // page instead of the route's normal JSON response.
      }
      if (!importResponse.ok || !body.document || !body.version || !body.source || !body.pageMap) {
        setStatus(body.error ?? `Import failed (server returned ${importResponse.status}). The completed split PDF is still available to download.`);
        setImportBusyId(null);
        return;
      }

      // Make the newly-created PDF the active reading document immediately.
      // The first implementation claimed it would appear in a "document
      // library", but no live library is mounted in this app; that stranded
      // a successfully-created database document with no UI path to open it.
      // This writes the exact current-document shape the main workspace
      // already restores on load, then reloads into the new PDF. The original
      // document and its annotations remain untouched in server storage.
      localStorage.setItem(
        DOCUMENT_KEY,
        JSON.stringify({
          id: body.document.id,
          title,
          filename: "split-two-page-spreads.pdf",
          kind: "PDF",
          mediaType: "application/pdf",
          size: body.storedFile?.size ?? 0,
          source: body.sourceMetadata ?? { author: "", title, place: "", publisher: "", year: "" },
          pageMap: { basePdfPageIndex: 1, baseBookPage: 1, currentPdfPageIndex: 1 },
          server: {
            documentId: body.document.id,
            versionId: body.version.id,
            sourceId: body.source.id,
            pageMapId: body.pageMap.id,
            storageKey: body.storedFile?.storageKey ?? body.document.storageKey ?? undefined,
            snapshotKey: body.version.snapshotKey ?? undefined
          }
        })
      );
      localStorage.setItem("scriptorium.annotations", "[]");
      localStorage.removeItem("scriptorium.currentTextContent");
      localStorage.setItem(
        PENDING_SPLIT_OCR_KEY,
        JSON.stringify({
          documentId: body.document.id,
          versionId: body.version.id,
          title,
          pageCount: result.splitSummary?.newPageCount
        })
      );
      setImportedTitle(title);
      setStatus(`Created "${title}" as a new document. Opening it now and prompting for the required OCR pass; the original document remains untouched.`);
      window.location.reload();
    } catch {
      setStatus("Import failed - the server did not respond.");
    } finally {
      setImportBusyId(null);
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
          Check for PDFs
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
                {result.alreadySplit ? (
                  <span className="toolsBadge toolsBadgeFresh">Already split</span>
                ) : result.splitRunning ? (
                  <span className="toolsBadge toolsBadgeStale">Splitting&hellip;</span>
                ) : result.splitReady ? (
                  <span className="toolsBadge toolsBadgeFresh">Split ready</span>
                ) : result.splitFailed ? (
                  <span className="toolsBadge toolsBadgeStale">Split failed</span>
                ) : (
                  <span className="toolsBadge">Not split yet</span>
                )}
                <strong>{result.documentTitle}</strong>
              </div>
              {!result.hasStoredPdf ? <p>No server-stored PDF file is available for this version, so there&apos;s nothing to split.</p> : null}
              {result.alreadySplit ? (
                <p>This is the imported split output{result.pageCount ? ` with ${result.pageCount} single PDF pages` : ""}. It will not be offered for splitting again.</p>
              ) : null}
              {result.splitRunning && result.splitProgress && result.splitProgress.total > 0 ? (
                <div>
                  <div
                    className="toolsProgressTrack"
                    role="progressbar"
                    aria-valuenow={result.splitProgress.completed}
                    aria-valuemin={0}
                    aria-valuemax={result.splitProgress.total}
                  >
                    <div
                      className="toolsProgressFill"
                      style={{ width: `${Math.round((result.splitProgress.completed / result.splitProgress.total) * 100)}%` }}
                    />
                  </div>
                  <span className="toolsProgressLabel">
                    {result.splitProgress.completed} / {result.splitProgress.total} pages (
                    {Math.round((result.splitProgress.completed / result.splitProgress.total) * 100)}%)
                    {result.versionId === busyId && etaText ? ` \u00b7 ${etaText}` : ""}
                  </span>
                </div>
              ) : null}
              {result.splitReady && result.splitSummary ? (
                <small>
                  {result.splitSummary.splitOriginalPageNumbers.length} of {result.splitSummary.originalPageCount} original page(s)
                  split &middot; {result.splitSummary.newPageCount} total pages in the result
                </small>
              ) : null}
              <div className="toolsResultRowActions">
                {!result.alreadySplit ? <button
                  className="secondaryButton"
                  type="button"
                  disabled={!result.hasStoredPdf || busyId === result.versionId || result.splitRunning}
                  onClick={() => startSplit(result.versionId)}
                >
                  {result.splitRunning ? "Running\u2026" : result.splitReady ? "Re-run split" : "Split this document"}
                </button> : null}
                {result.splitReady ? (
                  <a
                    className="secondaryButton"
                    href={`/api/page-split/download?versionId=${encodeURIComponent(result.versionId)}`}
                    download
                  >
                    Download split PDF
                  </a>
                ) : null}
                {result.splitReady ? (
                  <button
                    className="primaryButton"
                    type="button"
                    disabled={importBusyId === result.versionId}
                    onClick={() => createAsNewDocument(result)}
                  >
                    {importBusyId === result.versionId ? "Creating\u2026" : "Create as new document"}
                  </button>
                ) : null}
              </div>
              {result.splitReady && importedTitle ? (
                <small className="toolsHint">
                  Imported as &quot;{importedTitle}&quot; with the original document&apos;s saved citation metadata.
                </small>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}

