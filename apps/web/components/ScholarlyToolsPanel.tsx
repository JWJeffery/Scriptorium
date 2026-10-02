"use client";

import { useEffect, useState } from "react";
import type { ReadingNoteCandidate } from "../lib/reading-notes-import";
import { ThreadsSection, type OpenAnnotationRequest } from "./ThreadsPanel";
import { BackupSection } from "./BackupPanel";
import { MeaningIndexSection } from "./MeaningIndexPanel";


// This panel presents the advanced citation, export, OCR, and page-splitting
// workflows that sit alongside the main reading workspace.

import { ReadingNotesImportSection } from "./ReadingNotesImportSection";
import { CslSourceEditorSection } from "./CslSourceEditorSection";
import { OcrStatusSection } from "./OcrStatusSection";
import { PageSplitSection } from "./PageSplitSection";
import { PENDING_SPLIT_OCR_KEY, type CurrentDocumentRef, type PendingSplitOcr, type ImportedReadingNoteRecord, readCurrentDocumentRef, readPendingSplitOcr } from "../lib/tools-shared";
export type { ImportedReadingNoteRecord };

type ToolsTab = "threads" | "meaning" | "backup" | "source-editor" | "regeneration" | "export" | "ocr" | "page-split" | "notes-import";

const TABS: { key: ToolsTab; label: string }[] = [
  { key: "threads", label: "Research threads" },
  { key: "meaning", label: "Meaning search" },
  { key: "backup", label: "Backup" },
  { key: "source-editor", label: "Expanded citation source" },
  { key: "regeneration", label: "Citation regeneration" },
  { key: "export", label: "Corpus export" },
  { key: "notes-import", label: "Import reading notes" },
  { key: "ocr", label: "OCR scan detection" },
  { key: "page-split", label: "Split two-page spreads" }
];

export function ScholarlyToolsPanel({
  active = true,
  onPreviewReadingNote,
  onReadingNotesImported,
  onOpenAnnotation
}: {
  active?: boolean;
  onOpenAnnotation?: (request: OpenAnnotationRequest) => void;
  onPreviewReadingNote?: (candidate: ReadingNoteCandidate) => void;
  onReadingNotesImported?: (records: ImportedReadingNoteRecord[]) => void;
}) {
  const [tab, setTab] = useState<ToolsTab>("threads");
  const [currentRef, setCurrentRef] = useState<CurrentDocumentRef>({});
  const [pendingSplitOcr, setPendingSplitOcr] = useState<PendingSplitOcr | null>(null);

  useEffect(() => {
    setCurrentRef(readCurrentDocumentRef());
  }, [active, tab]);

  useEffect(() => {
    const pending = readPendingSplitOcr();
    if (pending) {
      setPendingSplitOcr(pending);
      setTab("ocr");
    }
  }, []);

  function clearPendingSplitOcr() {
    localStorage.removeItem(PENDING_SPLIT_OCR_KEY);
    setPendingSplitOcr(null);
  }

  return (
    <section className="toolsPanel" aria-label="Scholarly tools">
      <div className="toolsPanelHeader">
        <div>
          <p className="eyebrow">Research utilities</p>
          <h2>Scholarly tools</h2>
          <p>
            Expanded citation records, staleness-aware regeneration, full corpus backup, and scanned-PDF detection.
            Manage source records and prepare documents for scholarly reading.
          </p>
        </div>
        {currentRef.title ? (
          <div className="toolsCurrentDoc">
            <span>Current registered source</span>
            <strong>{currentRef.title}</strong>
          </div>
        ) : (
          <div className="toolsCurrentDoc">
            <span>No document registered in this browser yet</span>
            <strong>Register one above, or enter ids by hand below.</strong>
          </div>
        )}
      </div>
      {pendingSplitOcr && pendingSplitOcr.documentId === currentRef.documentId ? (
        <div className="toolsAttention" role="status">
          <div>
            <strong>OCR required for the new split document</strong>
            <p>
              The split copy contains {pendingSplitOcr.pageCount ? `${pendingSplitOcr.pageCount} ` : ""}image pages and initially reports zero extracted words. Run OCR now to make its text selectable,
              searchable, and exportable as a searchable PDF.
            </p>
          </div>
          <button className="primaryButton" type="button" onClick={() => setTab("ocr")}>Open OCR scan detection</button>
        </div>
      ) : null}
      <div className="toolsTabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? "toolsTab active" : "toolsTab"}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="toolsSection">
        {tab === "threads" ? <ThreadsSection active={active} onOpenAnnotation={onOpenAnnotation} /> : null}
        {tab === "meaning" ? <MeaningIndexSection active={active} /> : null}
        {tab === "backup" ? <BackupSection active={active} /> : null}
        {tab === "source-editor" ? <CslSourceEditorSection currentRef={currentRef} /> : null}
        {tab === "regeneration" ? <CitationRegenerationSection currentRef={currentRef} /> : null}
        {tab === "export" ? <CorpusExportSection /> : null}
        {tab === "notes-import" ? (
          <ReadingNotesImportSection
            currentRef={currentRef}
            onPreview={onPreviewReadingNote}
            onImported={onReadingNotesImported}
          />
        ) : null}
        {tab === "ocr" ? (
          <OcrStatusSection
            currentRef={currentRef}
            pendingOcrVersionId={pendingSplitOcr?.versionId}
            onOcrReady={clearPendingSplitOcr}
          />
        ) : null}
        {tab === "page-split" ? <PageSplitSection currentRef={currentRef} /> : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Existing reading-notes importer
// ---------------------------------------------------------------------------

type RegenerationResult = {
  citationId: string;
  sourceId: string;
  annotationId: string;
  styleId: string;
  stale: boolean;
  generatedText: string;
  sourceUpdatedAt: string;
  citationSnapshotAt: string;
};

function CitationRegenerationSection({ currentRef }: { currentRef: CurrentDocumentRef }) {
  const [documentId, setDocumentId] = useState(currentRef.documentId ?? "");
  const [results, setResults] = useState<RegenerationResult[]>([]);
  const [status, setStatus] = useState("Look up this document's live citations to see which ones are stale.");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (currentRef.documentId) setDocumentId(currentRef.documentId);
  }, [currentRef.documentId]);

  async function lookUp() {
    if (!documentId.trim()) {
      setStatus("Enter a document id (or register a document above) first.");
      return;
    }
    setStatus("Checking citation staleness...");
    try {
      const response = await fetch(`/api/citations/regenerate?documentId=${encodeURIComponent(documentId.trim())}`);
      const body = (await response.json()) as { count?: number; staleCount?: number; results?: RegenerationResult[]; error?: string };
      if (!response.ok) {
        setStatus(body.error ?? "Lookup failed.");
        setResults([]);
        return;
      }
      setResults(body.results ?? []);
      setStatus(`${body.count ?? 0} live citation(s) found, ${body.staleCount ?? 0} stale.`);
    } catch {
      setStatus("Lookup failed - the server did not respond.");
    }
  }

  async function regenerate(citationId: string, force: boolean) {
    setBusyId(citationId);
    try {
      const response = await fetch("/api/citations/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ citationId, force })
      });
      const body = (await response.json()) as { regenerated?: boolean; reason?: string; citation?: RegenerationResult; error?: string };
      if (!response.ok) {
        setStatus(body.error ?? "Regeneration failed.");
        return;
      }
      if (!body.regenerated) {
        setStatus(body.reason ?? "Citation is not stale; nothing to regenerate.");
        return;
      }
      setStatus("Regenerated. Re-checking the list...");
      await lookUp();
    } catch {
      setStatus("Regeneration failed - the server did not respond.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="toolsFormLayout">
      <div className="toolsForm">
        <label>
          Document id
          <input value={documentId} onChange={(event) => setDocumentId(event.target.value)} placeholder="Filled automatically from the registered document above" />
        </label>
        <button className="primaryButton" type="button" onClick={lookUp}>
          Check citations
        </button>
        <p className="statusLine toolsStatusLine">{status}</p>
      </div>
      <div className="toolsResultsStack">
        {results.length === 0 ? (
          <p className="emptyAnnotationState">No citations checked yet.</p>
        ) : (
          results.map((result) => (
            <article className="toolsResultRow" key={result.citationId}>
              <div className="toolsResultRowHeader">
                <span className={result.stale ? "toolsBadge toolsBadgeStale" : "toolsBadge toolsBadgeFresh"}>
                  {result.stale ? "Stale" : "Current"}
                </span>
                <strong>{result.styleId}</strong>
              </div>
              <p className="recordCitation">{result.generatedText}</p>
              <small>
                Source last updated {new Date(result.sourceUpdatedAt).toLocaleString()} &middot; citation snapshot{" "}
                {new Date(result.citationSnapshotAt).toLocaleString()}
              </small>
              <div className="toolsResultRowActions">
                <button className="secondaryButton" type="button" disabled={busyId === result.citationId} onClick={() => regenerate(result.citationId, false)}>
                  Regenerate if stale
                </button>
                <button className="secondaryButton" type="button" disabled={busyId === result.citationId} onClick={() => regenerate(result.citationId, true)}>
                  Force regenerate
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Corpus export
// ---------------------------------------------------------------------------

type CorpusCounts = {
  documents: number;
  sources: number;
  annotations: number;
  citations: number;
  threads: number;
  storedFiles: number;
};

function CorpusExportSection() {
  const [status, setStatus] = useState("Exports the full scholarly record set as one JSON bundle you can save.");
  const [counts, setCounts] = useState<CorpusCounts | null>(null);
  const [busy, setBusy] = useState(false);

  async function runExport() {
    setBusy(true);
    setStatus("Building export...");
    try {
      const response = await fetch("/api/export/corpus");
      if (!response.ok) {
        setStatus("Export failed.");
        return;
      }
      const body = (await response.json()) as { counts: CorpusCounts; exportedAt: string; [key: string]: unknown };
      setCounts(body.counts);
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `scriptorium-corpus-export-${body.exportedAt.replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus("Export downloaded. Note: this covers database records only, not PDF/text file bytes - see storedFiles below for the file manifest to back up separately.");
    } catch {
      setStatus("Export failed - the server did not respond.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolsFormLayout">
      <div className="toolsForm">
        <p>Downloads documents, versions, page maps, text spans, sources, annotations, citations (with regeneration lineage), and research threads as one JSON file.</p>
        <button className="primaryButton" type="button" onClick={runExport} disabled={busy}>
          Export full corpus
        </button>
        <p className="statusLine toolsStatusLine">{status}</p>
      </div>
      {counts ? (
        <div className="toolsCountsGrid">
          <div className="toolsCountCard">
            <strong>{counts.documents}</strong>
            <span>Documents</span>
          </div>
          <div className="toolsCountCard">
            <strong>{counts.sources}</strong>
            <span>Sources</span>
          </div>
          <div className="toolsCountCard">
            <strong>{counts.annotations}</strong>
            <span>Annotations</span>
          </div>
          <div className="toolsCountCard">
            <strong>{counts.citations}</strong>
            <span>Citations</span>
          </div>
          <div className="toolsCountCard">
            <strong>{counts.threads}</strong>
            <span>Research threads</span>
          </div>
          <div className="toolsCountCard">
            <strong>{counts.storedFiles}</strong>
            <span>Stored files</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OCR scan detection
// ---------------------------------------------------------------------------

