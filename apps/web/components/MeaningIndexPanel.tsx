"use client";

import { useCallback, useEffect, useState } from "react";

type Progress = { done: number; total: number; state: "running" | "finished" | "failed"; error?: string } | null;
type DocumentIndex = { documentId: string; title: string; kind: string; pages: number; pagePassages: number; notePassages: number; progress: Progress };
type ModelState = { ready: boolean; model: string; bytes: number };

/** "Meaning search" tab: build the by-meaning index for each book. */
export function MeaningIndexSection({ active = true }: { active?: boolean }) {
  const [documents, setDocuments] = useState<DocumentIndex[] | null>(null);
  const [model, setModel] = useState<ModelState | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/embeddings");
      const body = (await response.json()) as { model: ModelState; documents: DocumentIndex[] };
      setModel(body.model);
      setDocuments(body.documents);
      return body.documents;
    } catch {
      setMessage("Could not load the index status.");
      return null;
    }
  }, []);

  useEffect(() => { if (active) void load(); }, [active, load]);

  // While anything is being built, check every couple of seconds.
  const building = documents?.some((entry) => entry.progress?.state === "running") ?? false;
  useEffect(() => {
    if (!active || !building) return;
    const timer = window.setInterval(() => { void load(); }, 2000);
    return () => window.clearInterval(timer);
  }, [active, building, load]);

  async function build(documentId: string) {
    setMessage("");
    const response = await fetch("/api/embeddings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId }) });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) setMessage(body.error ?? "Could not start.");
    await load();
  }

  async function remove(documentId: string) {
    await fetch(`/api/embeddings?documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" });
    await load();
  }

  const withText = (documents ?? []).filter((entry) => entry.pages > 0);
  return (
    <div className="meaningSection">
      <p>
        <strong>Related passages</strong> search can find a passage by what it is <em>about</em>, even when it uses none of your words. For that, Scriptorium reads each book once and stores a short numerical summary of every passage.
        It happens on this computer: nothing is sent anywhere. Books you have not indexed are still searched by shared words.
      </p>
      <p className="backupFine">
        {model?.ready ? `The reading model (${model.model}, ${Math.round(model.bytes / 1_000_000)} MB) is installed.` : "The first time you build an index, a 23 MB English reading model is downloaded once from huggingface.co and checked against a known checksum."}
        {" "}A 300-page book takes a few minutes. You can keep reading meanwhile.
      </p>
      {message ? <p className="threadMessage" role="alert">{message}</p> : null}
      {documents === null ? <p>Loading…</p> : withText.length === 0 ? <p className="threadEmpty">No books with readable text yet. A scanned book needs OCR first (Scholarly tools &gt; OCR).</p> : (
        <ul className="backupList">
          {withText.map((entry) => {
            const running = entry.progress?.state === "running";
            const indexed = entry.pagePassages > 0;
            return (
              <li key={entry.documentId}>
                <span>
                  <strong>{entry.title}</strong>
                  <small>
                    {running ? `Reading… ${entry.progress?.done ?? 0} of ${entry.progress?.total || "…"} passages` : entry.progress?.state === "failed" ? `Failed: ${entry.progress.error}` : indexed ? `Indexed: ${entry.pagePassages} passages${entry.notePassages ? `, ${entry.notePassages} notes` : ""}` : `Not indexed · ${entry.pages} pages`}
                  </small>
                </span>
                <span>
                  <button type="button" className="textAction" disabled={running} onClick={() => void build(entry.documentId)}>{indexed ? "Update" : "Build index"}</button>{" "}
                  {indexed ? <button type="button" className="textAction dangerAction" disabled={running} onClick={() => void remove(entry.documentId)}>Remove</button> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
