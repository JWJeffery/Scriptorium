"use client";

import { useEffect, useState } from "react";

export type SavedDocumentEntry = {
  documentId: string;
  title: string;
  kind: "PDF" | "TXT" | "MARKDOWN" | "DOCX";
  filename: string;
  mediaType: string;
  size: number | null;
  storageKey: string | null;
  updatedAt: string;
  annotationCount: number;
  pageCount: number | null;
  fileMissing: boolean;
  versionId: string;
  snapshotKey: string | null;
  sourceChecksum: string | null;
  sourceId: string;
  cslJson: unknown;
  pageMapId: string;
  pdfPageIndex: number;
  pageMapNote: string | null;
  bookPageLabel: string | null;
};

type Props = {
  open: boolean;
  currentDocumentId?: string;
  onOpenDocument: (entry: SavedDocumentEntry) => void;
  onClose: () => void;
};

function sizeLabel(size: number | null) {
  if (size === null) return "";
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function SavedDocumentsPanel({ open, currentDocumentId, onOpenDocument, onClose }: Props) {
  const [entries, setEntries] = useState<SavedDocumentEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEntries(null);
    setError("");
    fetch("/api/milestone-one/library")
      .then(async (response) => {
        if (!response.ok) throw new Error(`The server answered ${response.status}.`);
        return (await response.json()) as { documents: SavedDocumentEntry[] };
      })
      .then((body) => { if (!cancelled) setEntries(body.documents); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "The list could not be loaded."); });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <button className="drawerScrim" type="button" onClick={onClose} aria-label="Close saved documents" />
      <div className="savedDocsDialog" role="dialog" aria-modal="true" aria-label="Saved documents">
        <div className="drawerHeader">
          <div><p className="eyebrow">On the server</p><strong>Saved documents</strong></div>
          <button type="button" onClick={onClose} aria-label="Close saved documents">×</button>
        </div>
        <div className="savedDocsBody">
          {error ? <p className="savedDocsNote">Could not load the list. {error}</p> : null}
          {!error && entries === null ? <p className="savedDocsNote">Loading…</p> : null}
          {entries?.length === 0 ? <p className="savedDocsNote">No documents have been saved to the server yet.</p> : null}
          {entries?.map((entry) => {
            const isCurrent = entry.documentId === currentDocumentId;
            return (
              <article className={`savedDocRow${isCurrent ? " current" : ""}`} key={entry.documentId}>
                <div>
                  <strong>{entry.title}</strong>
                  <span>
                    {entry.kind} · {entry.filename}
                    {entry.size !== null ? ` · ${sizeLabel(entry.size)}` : ""}
                    {entry.pageCount ? ` · ${entry.pageCount} pages` : ""}
                  </span>
                  <span>
                    {entry.annotationCount} annotation{entry.annotationCount === 1 ? "" : "s"} · saved {new Date(entry.updatedAt).toLocaleDateString()}
                  </span>
                  {entry.fileMissing ? <span className="savedDocWarning">The stored file could not be found on the server.</span> : null}
                </div>
                {isCurrent ? <span className="savedDocCurrent">Open now</span> : <button className="compactAction" type="button" disabled={entry.fileMissing} onClick={() => onOpenDocument(entry)}>Open</button>}
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
