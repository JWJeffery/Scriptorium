"use client";

import { useEffect, useRef, useState } from "react";
import { authorsToText } from "../lib/author-names";

type Csl = Record<string, unknown>;
type Candidate = { csl: Csl; origin: string };

type Props = {
  open: boolean;
  onApply: (csl: Csl) => Promise<void>;
  onClose: () => void;
};

function summary(csl: Csl) {
  const authors = Array.isArray(csl.author) ? authorsToText(csl.author as Parameters<typeof authorsToText>[0]) : "";
  const year = (csl.issued as { "date-parts"?: unknown[][] } | undefined)?.["date-parts"]?.[0]?.[0];
  const container = typeof csl["container-title"] === "string" ? csl["container-title"] : "";
  return { title: typeof csl.title === "string" ? csl.title : "(no title)", line: [authors, container, year ? String(year) : ""].filter(Boolean).join(" · ") };
}

/** Fill a source's details from an ISBN, a DOI, or a Zotero/BibTeX/RIS/CSL JSON export. */
export function SourceLookupDialog({ open, onApply, onClose }: Props) {
  const [tab, setTab] = useState<"lookup" | "file">("lookup");
  const [query, setQuery] = useState("");
  const [pasted, setPasted] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 30); }, [open, tab]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function showPreviews(list: Candidate[]) {
    setCandidates(list);
    setPreviews({});
    await Promise.all(list.slice(0, 20).map(async (candidate, index) => {
      try {
        const response = await fetch("/api/cite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ style: "sbl-note", items: [{ csl: candidate.csl }] }) });
        if (!response.ok) return;
        const body = await response.json() as { citations: Array<{ text: string }> };
        setPreviews((current) => ({ ...current, [index]: body.citations[0].text }));
      } catch { /* the preview is a nicety */ }
    }));
  }

  async function lookUp() {
    setBusy(true); setMessage(""); setCandidates([]);
    try {
      const response = await fetch("/api/sources/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
      const body = await response.json() as { error?: string; csl?: Csl; provider?: string };
      if (!response.ok || !body.csl) { setMessage(body.error ?? "Nothing was found."); return; }
      await showPreviews([{ csl: body.csl, origin: body.provider ?? "" }]);
    } catch { setMessage("The lookup could not be reached. Check the internet connection and try again."); }
    finally { setBusy(false); }
  }

  async function readText(text: string, origin: string) {
    setBusy(true); setMessage(""); setCandidates([]);
    try {
      const response = await fetch("/api/sources/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await response.json() as { error?: string; entries?: Csl[] };
      if (!response.ok || !body.entries) { setMessage(body.error ?? "That could not be read."); return; }
      await showPreviews(body.entries.map((csl) => ({ csl, origin })));
      if (body.entries.length > 1) setMessage(`${body.entries.length} entries found. Choose the one that is this book.`);
    } catch { setMessage("That could not be read."); }
    finally { setBusy(false); }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) { setMessage("That file is too large to import."); return; }
    await readText(await file.text(), file.name);
  }

  async function use(candidate: Candidate) {
    setBusy(true);
    try { await onApply(candidate.csl); onClose(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not apply those details."); }
    finally { setBusy(false); }
  }

  if (!open) return null;
  return (
    <>
      <button className="drawerScrim" type="button" onClick={onClose} aria-label="Close" />
      <div className="savedDocsDialog lookupDialog" role="dialog" aria-modal="true" aria-label="Fill in source details">
        <div className="drawerHeader">
          <div><p className="eyebrow">Source metadata</p><strong>Fill in details</strong></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="savedDocsBody">
          <div className="lookupTabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "lookup"} className={tab === "lookup" ? "active" : ""} onClick={() => { setTab("lookup"); setCandidates([]); setMessage(""); }}>ISBN or DOI</button>
            <button type="button" role="tab" aria-selected={tab === "file"} className={tab === "file" ? "active" : ""} onClick={() => { setTab("file"); setCandidates([]); setMessage(""); }}>From Zotero or a file</button>
          </div>

          {tab === "lookup" ? (
            <div className="lookupForm">
              <label>ISBN of the book, or DOI of the article
                <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && query.trim()) void lookUp(); }} placeholder="e.g. 978-0-8028-2753-1 or 10.1038/nature12373" />
              </label>
              <button type="button" className="primaryButton" disabled={busy || !query.trim()} onClick={() => void lookUp()}>{busy ? "Looking…" : "Look up"}</button>
            </div>
          ) : (
            <div className="lookupForm">
              <p className="backupFine">In Zotero choose <strong>File → Export Library</strong> (or right-click items → Export Items) and pick <strong>BibTeX</strong>, <strong>RIS</strong> or <strong>CSL JSON</strong>. Then open the file here, or paste its text.</p>
              <label>Open an exported file<input ref={inputRef} type="file" accept=".bib,.bibtex,.ris,.json,.txt,text/plain,application/json" onChange={(event) => void onFile(event.target.files?.[0])} /></label>
              <label>…or paste the text<textarea rows={5} value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder="@book{…}  or  TY  - BOOK …" /></label>
              <button type="button" className="secondaryButton" disabled={busy || !pasted.trim()} onClick={() => void readText(pasted, "pasted text")}>Read the pasted text</button>
            </div>
          )}

          {message ? <p className="lookupMessage" role="status">{message}</p> : null}
          {candidates.map((candidate, index) => {
            const info = summary(candidate.csl);
            return (
              <article className="lookupCandidate" key={index}>
                <div>
                  <strong>{info.title}</strong>
                  <span>{info.line}</span>
                  {previews[index] ? <em>As an SBL note: {previews[index]}</em> : null}
                  <small>From {candidate.origin}</small>
                </div>
                <button type="button" className="primaryButton" disabled={busy} onClick={() => void use(candidate)}>Use these details</button>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
