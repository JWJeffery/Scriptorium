"use client";

import { FormEvent, useState } from "react";
import type { ReadingNoteCandidate } from "../lib/reading-notes-import";




import { DOCX_MEDIA_TYPE, type CurrentDocumentRef, type ImportedReadingNoteRecord } from "../lib/tools-shared";

type AnalyzedReadingNote = ReadingNoteCandidate & { citationText: string };
type ReadingNotesAnalysis = {
  filename: string;
  warningCount: number;
  ocrPageCount: number;
  parsedCount: number;
  candidates: AnalyzedReadingNote[];
  summary: { high: number; review: number; unmatched: number; pageNotes: number };
};

function matchLabel(candidate: ReadingNoteCandidate) {
  if (candidate.matchStatus === "page-note") return "Page note";
  if (candidate.matchStatus === "unmatched") return "No reliable match";
  return `${Math.round(candidate.confidence * 100)}% ${candidate.matchStatus === "high" ? "match" : "— review"}`;
}

export function ReadingNotesImportSection({
  currentRef,
  onPreview,
  onImported
}: {
  currentRef: CurrentDocumentRef;
  onPreview?: (candidate: ReadingNoteCandidate) => void;
  onImported?: (records: ImportedReadingNoteRecord[]) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [style, setStyle] = useState("sbl-note");
  const [analysis, setAnalysis] = useState<ReadingNotesAnalysis | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Choose the DOCX where you recorded quotations and comments.");
  const ready = Boolean(currentRef.documentId && currentRef.versionId && currentRef.sourceId);

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (!file || !ready) {
      setStatus("Register the PDF in this browser and choose a DOCX notes file first.");
      return;
    }
    setBusy(true);
    setAnalysis(null);
    setStatus("Reading the notes and aligning quotations with OCR text…");
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("documentId", currentRef.documentId!);
      formData.set("versionId", currentRef.versionId!);
      formData.set("sourceId", currentRef.sourceId!);
      formData.set("citationStyle", style);
      formData.set("basePdfPageIndex", String(currentRef.basePdfPageIndex ?? 1));
      formData.set("baseBookPage", String(currentRef.baseBookPage ?? 1));
      const response = await fetch("/api/reading-notes", { method: "POST", body: formData });
      const body = await response.json() as ReadingNotesAnalysis & { error?: string };
      if (!response.ok) throw new Error(body.error || "The notes could not be analyzed.");
      setAnalysis(body);
      setSelected(new Set(body.candidates.filter((candidate) => candidate.matchStatus === "high" || candidate.matchStatus === "page-note").map((candidate) => candidate.id)));
      setStatus(`Found ${body.parsedCount} note${body.parsedCount === 1 ? "" : "s"}. Review uncertain matches, then import the checked records.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The notes could not be analyzed.");
    } finally {
      setBusy(false);
    }
  }

  function updateCandidate(id: string, field: "note" | "selectedText", value: string) {
    setAnalysis((current) => current ? {
      ...current,
      candidates: current.candidates.map((candidate) => candidate.id === id ? { ...candidate, [field]: value } : candidate)
    } : current);
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function importSelected() {
    if (!analysis || !ready) return;
    const candidates = analysis.candidates.filter((candidate) => selected.has(candidate.id));
    if (candidates.length === 0) {
      setStatus("Check at least one matched highlight or page note to import.");
      return;
    }
    setBusy(true);
    setStatus(`Importing ${candidates.length} reviewed record${candidates.length === 1 ? "" : "s"}…`);
    try {
      const response = await fetch("/api/reading-notes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId: currentRef.documentId,
          versionId: currentRef.versionId,
          sourceId: currentRef.sourceId,
          citationStyle: style,
          candidates: candidates.map((candidate) => ({ ...candidate, colorKey: "yellow" }))
        })
      });
      const body = await response.json() as { importedCount?: number; records?: ImportedReadingNoteRecord[]; error?: string };
      if (!response.ok || !body.records) throw new Error(body.error || "The reviewed notes could not be imported.");
      onImported?.(body.records);
      setSelected(new Set());
      setStatus(`Imported ${body.importedCount} annotation${body.importedCount === 1 ? "" : "s"} into the Ledger.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The reviewed notes could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="readingNotesImporter">
      <form className="toolsForm" onSubmit={analyze}>
        <h3>Bring earlier reading notes into this book</h3>
        <p className="toolsHint">
          Quoted passages become OCR-anchored highlights. Your prose becomes the annotation. Entries without a quotation remain attached to their cited book page as page notes.
        </p>
        <label>Reading notes DOCX<input type="file" accept={`${DOCX_MEDIA_TYPE},.docx`} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label>Citation style<select value={style} onChange={(event) => setStyle(event.target.value)}><option value="sbl-note">SBL / Chicago / Turabian note</option><option value="apa">APA</option><option value="mla">MLA</option><option value="harvard">Harvard</option></select></label>
        <button className="primaryButton" type="submit" disabled={!file || !ready || busy}>{busy && !analysis ? "Analyzing…" : "Analyze notes"}</button>
        {!ready ? <p className="toolsStatusLine">The current PDF is not linked to a saved server record.</p> : null}
        <p className="toolsStatusLine" role="status">{status}</p>
      </form>

      {analysis ? (
        <div className="readingNotesReview">
          <div className="readingNotesSummary">
            <strong>{analysis.parsedCount} parsed</strong>
            <span>{analysis.summary.high} strong matches</span>
            <span>{analysis.summary.review} need review</span>
            <span>{analysis.summary.pageNotes} page notes</span>
            <span>{analysis.summary.unmatched} unmatched</span>
          </div>
          {analysis.ocrPageCount === 0 ? <div className="toolsAttention"><p>No OCR word positions were found. Run OCR before importing highlights.</p></div> : null}
          <div className="readingNotesCandidates">
            {analysis.candidates.map((candidate) => {
              const canImport = candidate.matchStatus !== "unmatched";
              return (
                <article className={`readingNoteCandidate ${candidate.matchStatus}`} key={candidate.id}>
                  <div className="readingNoteCandidateHeader">
                    <label><input type="checkbox" checked={selected.has(candidate.id)} disabled={!canImport || busy} onChange={() => toggle(candidate.id)} /> Book p. {candidate.pageLabel}</label>
                    <span>{candidate.pdfPageIndex ? `PDF ${candidate.pdfPageIndex} · ` : ""}{matchLabel(candidate)}</span>
                  </div>
                  {candidate.kind === "highlight" ? <label>Passage<textarea value={candidate.selectedText} onChange={(event) => updateCandidate(candidate.id, "selectedText", event.target.value)} rows={3} /></label> : null}
                  <label>{candidate.kind === "page-note" ? "Page note" : "Annotation"}<textarea value={candidate.note} onChange={(event) => updateCandidate(candidate.id, "note", event.target.value)} rows={3} /></label>
                  <div className="toolsResultRowActions">
                    {candidate.anchor ? <button className="secondaryButton" type="button" onClick={() => onPreview?.(candidate)}>Preview in book</button> : null}
                    {candidate.matchStatus === "unmatched" ? <small>Keep for manual placement; this will not be imported automatically.</small> : null}
                  </div>
                </article>
              );
            })}
          </div>
          <button className="primaryButton" type="button" disabled={selected.size === 0 || busy} onClick={importSelected}>{busy ? "Importing…" : `Import ${selected.size} checked record${selected.size === 1 ? "" : "s"}`}</button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded CSL source editor
// ---------------------------------------------------------------------------

