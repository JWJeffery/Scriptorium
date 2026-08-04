"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

// This panel gives gates 14-17 their first screens. Until now they were
// real, callable API routes with zero UI (see RESUME_PROJECT_NOTE.md,
// "Outstanding work"). Nothing here touches ScriptoriumMilestoneOnePersisted
// or its routes - this is purely additive.
//
// Gate 14  -> /api/milestone-fourteen/csl-source-editor  (expanded CSL record)
//          -> /api/milestone-fourteen/citation-regenerate (also gate 15's staleness/lineage)
// Gate 16  -> /api/milestone-fifteen/corpus-export        (folder name predates gate renumbering)
// Gate 17  -> /api/milestone-sixteen/ocr-status            (folder name predates gate renumbering)

const DOCUMENT_KEY = "scriptorium.currentDocument";

type CurrentDocumentRef = { documentId?: string; sourceId?: string; title?: string };

function readCurrentDocumentRef(): CurrentDocumentRef {
  try {
    const raw = localStorage.getItem(DOCUMENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { title?: string; server?: { documentId?: string; sourceId?: string } };
    return { documentId: parsed.server?.documentId, sourceId: parsed.server?.sourceId, title: parsed.title };
  } catch {
    return {};
  }
}

type ToolsTab = "source-editor" | "regeneration" | "export" | "ocr";

const TABS: { key: ToolsTab; label: string }[] = [
  { key: "source-editor", label: "Expanded citation source" },
  { key: "regeneration", label: "Citation regeneration" },
  { key: "export", label: "Corpus export" },
  { key: "ocr", label: "OCR scan detection" }
];

export function ScholarlyToolsPanel() {
  const [tab, setTab] = useState<ToolsTab>("source-editor");
  const [currentRef, setCurrentRef] = useState<CurrentDocumentRef>({});

  useEffect(() => {
    setCurrentRef(readCurrentDocumentRef());
  }, [tab]);

  return (
    <section className="toolsPanel" aria-label="Scholarly tools: gates 14 through 17">
      <div className="toolsPanelHeader">
        <div>
          <p className="eyebrow">Gates 14&ndash;17</p>
          <h2>Scholarly tools</h2>
          <p>
            Expanded citation records, staleness-aware regeneration, full corpus backup, and scanned-PDF detection.
            These routes existed with no screen until now.
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
        {tab === "source-editor" ? <CslSourceEditorSection currentRef={currentRef} /> : null}
        {tab === "regeneration" ? <CitationRegenerationSection currentRef={currentRef} /> : null}
        {tab === "export" ? <CorpusExportSection /> : null}
        {tab === "ocr" ? <OcrStatusSection currentRef={currentRef} /> : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Gate 14: expanded CSL source editor
// ---------------------------------------------------------------------------

const SOURCE_TYPES = [
  { value: "book", label: "Book" },
  { value: "chapter", label: "Chapter" },
  { value: "article-journal", label: "Journal article" },
  { value: "manuscript", label: "Manuscript" }
];

type SourceEditorFormState = {
  sourceId: string;
  type: string;
  title: string;
  author: string;
  editor: string;
  translator: string;
  containerTitle: string;
  place: string;
  publisher: string;
  volume: string;
  edition: string;
  year: string;
};

const EMPTY_SOURCE_FORM: SourceEditorFormState = {
  sourceId: "",
  type: "book",
  title: "",
  author: "",
  editor: "",
  translator: "",
  containerTitle: "",
  place: "",
  publisher: "",
  volume: "",
  edition: "",
  year: ""
};

function CslSourceEditorSection({ currentRef }: { currentRef: CurrentDocumentRef }) {
  const [form, setForm] = useState<SourceEditorFormState>(EMPTY_SOURCE_FORM);
  const [status, setStatus] = useState("Fill in the fields this source actually needs and save.");
  const [savedShortTitle, setSavedShortTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (currentRef.sourceId) setForm((previous) => ({ ...previous, sourceId: currentRef.sourceId ?? "" }));
  }, [currentRef.sourceId]);

  function update<K extends keyof SourceEditorFormState>(key: K, value: SourceEditorFormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.sourceId.trim()) {
      setStatus("A source id is required. Register a document above first, or paste a source id below.");
      return;
    }
    setBusy(true);
    setStatus("Saving expanded source record...");
    try {
      const response = await fetch("/api/milestone-fourteen/csl-source-editor", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      });
      const body = (await response.json()) as { source?: { shortTitle?: string }; error?: string };
      if (!response.ok) {
        setStatus(body.error ?? "Save failed.");
        setSavedShortTitle(null);
        return;
      }
      setSavedShortTitle(body.source?.shortTitle ?? form.title);
      setStatus("Saved. This source's CSL record now carries the fuller item shape (editor, translator, container, volume, edition).");
    } catch {
      setStatus("Save failed - the server did not respond.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolsFormLayout">
      <form className="toolsForm" onSubmit={handleSubmit}>
        <label>
          Source id
          <input value={form.sourceId} onChange={(event) => update("sourceId", event.target.value)} placeholder="Filled automatically from the registered document above" />
        </label>
        <label>
          Source type
          <select value={form.type} onChange={(event) => update("type", event.target.value)}>
            {SOURCE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={form.title} onChange={(event) => update("title", event.target.value)} />
        </label>
        <div className="twoColumnInputs">
          <label>
            Author
            <input value={form.author} onChange={(event) => update("author", event.target.value)} />
          </label>
          <label>
            Editor
            <input value={form.editor} onChange={(event) => update("editor", event.target.value)} placeholder="For edited volumes" />
          </label>
        </div>
        <div className="twoColumnInputs">
          <label>
            Translator
            <input value={form.translator} onChange={(event) => update("translator", event.target.value)} />
          </label>
          <label>
            Container title
            <input value={form.containerTitle} onChange={(event) => update("containerTitle", event.target.value)} placeholder="Journal or larger work" />
          </label>
        </div>
        <div className="twoColumnInputs">
          <label>
            Place
            <input value={form.place} onChange={(event) => update("place", event.target.value)} />
          </label>
          <label>
            Publisher
            <input value={form.publisher} onChange={(event) => update("publisher", event.target.value)} />
          </label>
        </div>
        <div className="twoColumnInputs">
          <label>
            Volume
            <input value={form.volume} onChange={(event) => update("volume", event.target.value)} />
          </label>
          <label>
            Edition
            <input value={form.edition} onChange={(event) => update("edition", event.target.value)} />
          </label>
        </div>
        <label>
          Year
          <input value={form.year} onChange={(event) => update("year", event.target.value)} />
        </label>
        <button className="primaryButton" type="submit" disabled={busy}>
          Save expanded source record
        </button>
      </form>
      <div className="toolsSidebarNote">
        <p className="statusLine toolsStatusLine">{status}</p>
        {savedShortTitle ? (
          <div className="generatedCitation">
            <span>Saved short title</span>
            <p>{savedShortTitle}</p>
          </div>
        ) : null}
        <p className="toolsHint">
          The original book-only editor at Milestone 6 is untouched. This form writes to the same Source row but accepts
          chapters, journal articles, and manuscripts, with editor/translator/container/volume/edition fields.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gate 15: citation regeneration + staleness
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
      const response = await fetch(`/api/milestone-fourteen/citation-regenerate?documentId=${encodeURIComponent(documentId.trim())}`);
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
      const response = await fetch("/api/milestone-fourteen/citation-regenerate", {
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
// Gate 16 (folder milestone-fifteen): corpus export
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
      const response = await fetch("/api/milestone-fifteen/corpus-export");
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
// Gate 17 (folder milestone-sixteen): OCR scan detection
// ---------------------------------------------------------------------------

type OcrResult = {
  versionId: string;
  documentId: string;
  documentTitle: string;
  extractionState: string;
  ocrRunning: boolean;
  ocrProgress: { completed: number; total: number } | null;
  pageCount: number;
  extractedTextLength: number;
  likelyScanned: boolean;
  charsPerPage: number;
  reason: string;
};

function OcrStatusSection({ currentRef }: { currentRef: CurrentDocumentRef }) {
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
      const response = await fetch(`/api/milestone-sixteen/ocr-status${query}`);
      const body = (await response.json()) as { count?: number; likelyScannedCount?: number; results?: OcrResult[]; error?: string };
      if (!response.ok) {
        setStatus(body.error ?? "Lookup failed.");
        setResults([]);
        return;
      }
      setResults(body.results ?? []);
      const running = body.results?.find((result) => result.ocrRunning);
      if (running) {
        setStatus(`${body.count ?? 0} PDF version(s) checked, ${body.likelyScannedCount ?? 0} likely scanned. OCR is already running on "${running.documentTitle}" - resuming progress checks...`);
        setBusyId(running.versionId);
        rateAnchorRef.current = null;
        await pollUntilDone(running.versionId);
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
      const response = await fetch("/api/milestone-sixteen/ocr-status", {
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
      const response = await fetch(`/api/milestone-sixteen/ocr-status${query}`);
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
        setStatus(`OCR complete. ${match.extractedTextLength} character(s) recognized.`);
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
                  <small className="toolsHint">
                    Already OCR&apos;d successfully - re-run only if you need to regenerate it (e.g. after an OCR
                    pipeline update).
                  </small>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
