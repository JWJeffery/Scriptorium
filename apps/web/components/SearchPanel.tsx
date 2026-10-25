"use client";

import { useEffect, useRef, useState } from "react";
import { highlightColors } from "../lib/highlights";
import { parseQuery } from "../lib/search-text";

type Snippet = { before: string; match: string; after: string };
export type SearchPageHit = { documentId: string; documentTitle: string; versionId: string; pdfPageIndex: number | null; bookPage: string | null; line: number | null; snippet: Snippet };
export type SearchAnnotationHit = { annotationId: string; documentId: string; documentTitle: string; versionId: string; pdfPageIndex: number | null; bookPage: string | null; colorKey: string; tags: string[]; note: string; selectedText: string; snippet: Snippet };
type SearchThreadHit = { threadId: string; title: string; itemCount: number };
type SearchResponse = { method?: "words" | "meaning"; methodNote?: string; unindexed?: string[]; unindexedCount?: number; counts: { pages: number; annotations: number; threads: number }; pages: SearchPageHit[]; annotations: SearchAnnotationHit[]; threads: SearchThreadHit[]; truncated: boolean };

export type SearchOpenRequest =
  | { kind: "page"; hit: SearchPageHit; terms: string[] }
  | { kind: "annotation"; hit: SearchAnnotationHit; terms: string[] }
  | { kind: "thread"; threadId: string };

type Props = {
  open: boolean;
  currentDocumentId?: string;
  onOpenResult: (request: SearchOpenRequest) => void;
  onClose: () => void;
};

function Highlighted({ snippet }: { snippet: Snippet }) {
  return <>{snippet.before}{snippet.match ? <mark>{snippet.match}</mark> : null}{snippet.after}</>;
}

export function SearchPanel({ open, currentDocumentId, onOpenResult, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"exact" | "related">("exact");
  const [scope, setScope] = useState<"document" | "all">("document");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.select(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const useDocumentScope = scope === "document" && Boolean(currentDocumentId);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) { setResults(null); setError(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ q: trimmed, mode });
      if (useDocumentScope && currentDocumentId) params.set("documentId", currentDocumentId);
      fetch(`/api/search?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(response.status === 400 ? "Type at least two characters." : `The server answered ${response.status}.`);
          return (await response.json()) as SearchResponse;
        })
        .then((body) => { setResults(body); setError(""); })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Search failed."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, mode, useDocumentScope, currentDocumentId]);

  if (!open) return null;
  const terms = parseQuery(query);
  const total = results ? results.counts.pages + results.counts.annotations + results.counts.threads : 0;

  return (
    <>
      <button className="drawerScrim" type="button" onClick={onClose} aria-label="Close search" />
      <div className="searchDialog" role="dialog" aria-modal="true" aria-label="Search">
        <div className="searchControls">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "exact" ? "Search words or \"an exact phrase\"" : "Describe what you are looking for"}
            aria-label="Search"
            autoFocus
          />
          <div className="searchToggles">
            <div role="group" aria-label="Search type">
              <button type="button" className={mode === "exact" ? "active" : ""} aria-pressed={mode === "exact"} onClick={() => setMode("exact")}>Exact words</button>
              <button type="button" className={mode === "related" ? "active" : ""} aria-pressed={mode === "related"} onClick={() => setMode("related")} title="Ranks pages and notes by how much vocabulary they share with your description">Related passages</button>
            </div>
            <div role="group" aria-label="Where to search">
              <button type="button" className={useDocumentScope ? "active" : ""} aria-pressed={useDocumentScope} disabled={!currentDocumentId} onClick={() => setScope("document")}>This document</button>
              <button type="button" className={!useDocumentScope ? "active" : ""} aria-pressed={!useDocumentScope} onClick={() => setScope("all")}>All documents</button>
            </div>
            <button type="button" className="searchClose" onClick={onClose} aria-label="Close search">×</button>
          </div>
        </div>
        <div className="searchBody" aria-live="polite">
          {error ? <p className="searchNote">{error}</p> : null}
          {!error && results && mode === "related" ? (
            <p className="searchMethod">
              {results.method === "meaning" ? "Ranked by meaning." : "Ranked by shared words."}{" "}
              {results.methodNote}
              {results.method === "meaning" && results.unindexed && results.unindexed.length > 0 ? ` Not yet indexed, so not searched: ${results.unindexed.slice(0, 3).join("; ")}${(results.unindexedCount ?? results.unindexed.length) > 3 ? ` and ${(results.unindexedCount ?? 0) - 3} more` : ""}.` : ""}
            </p>
          ) : null}
          {!error && query.trim().length < 2 ? <p className="searchNote">Type to search the text of your books, your notes, tags and threads. Press Esc to close.</p> : null}
          {!error && loading && !results ? <p className="searchNote">Searching…</p> : null}
          {!error && results && total === 0 && !loading ? <p className="searchNote">Nothing found. {mode === "exact" ? "Try fewer words, or Related passages." : "Try different words."}</p> : null}

          {results && results.counts.annotations > 0 ? (
            <section>
              <h3>Notes and highlights · {results.counts.annotations}</h3>
              {results.annotations.map((hit) => {
                const color = highlightColors.find((item) => item.key === hit.colorKey) ?? highlightColors[0];
                return (
                  <button type="button" className="searchHit" key={hit.annotationId} onClick={() => onOpenResult({ kind: "annotation", hit, terms })}>
                    <span className="searchHitHead"><span className="recordColor" style={{ background: color.color }} /><strong>{color.defaultMeaning}</strong>{hit.bookPage ? <span>book p. {hit.bookPage}</span> : null}{scope === "all" || !useDocumentScope ? <span>{hit.documentTitle}</span> : null}</span>
                    <span className="searchHitText"><Highlighted snippet={hit.snippet} /></span>
                    {hit.tags.length ? <span className="searchHitTags">{hit.tags.map((tag) => `#${tag}`).join(" ")}</span> : null}
                  </button>
                );
              })}
            </section>
          ) : null}

          {results && results.counts.pages > 0 ? (
            <section>
              <h3>Pages · {results.counts.pages}{results.truncated ? "+" : ""}</h3>
              {results.pages.map((hit) => (
                <button type="button" className="searchHit" key={`${hit.versionId}-${hit.pdfPageIndex ?? hit.line}`} onClick={() => onOpenResult({ kind: "page", hit, terms })}>
                  <span className="searchHitHead">
                    <strong>{hit.bookPage ? `Book p. ${hit.bookPage}` : hit.line ? `Line ${hit.line}` : "Document"}</strong>
                    {hit.pdfPageIndex ? <span>PDF {hit.pdfPageIndex}</span> : null}
                    {!useDocumentScope ? <span>{hit.documentTitle}</span> : null}
                  </span>
                  <span className="searchHitText"><Highlighted snippet={hit.snippet} /></span>
                </button>
              ))}
            </section>
          ) : null}

          {results && results.threads.length > 0 ? (
            <section>
              <h3>Research threads · {results.counts.threads}</h3>
              {results.threads.map((thread) => (
                <button type="button" className="searchHit" key={thread.threadId} onClick={() => onOpenResult({ kind: "thread", threadId: thread.threadId })}>
                  <span className="searchHitHead"><strong>{thread.title}</strong><span>{thread.itemCount} item{thread.itemCount === 1 ? "" : "s"}</span></span>
                </button>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
