"use client";

import { useCallback, useEffect, useState } from "react";
import { highlightColors } from "../lib/highlights";

type ThreadSummary = { id: string; title: string; description: string; tags: string[]; itemCount: number };
type ItemContext =
  | { itemType: "ANNOTATION"; documentId: string; documentTitle: string; pdfPageIndex: number | null; bookPage: string | null; colorKey: string; selectedText: string; note: string; tags: string[]; citationText: string }
  | { itemType: "DOCUMENT"; documentTitle: string }
  | { itemType: "SOURCE"; title: string; citationText: string }
  | { itemType: "CITATION"; citationText: string }
  | { itemType: "NOTE" }
  | null;
type ThreadItem = { id: string; itemType: string; itemId: string; note: string; orderIndex: number; context: ItemContext };
type ThreadDetail = { id: string; title: string; description: string; tags: string[]; items: ThreadItem[] };

export type OpenAnnotationRequest = { annotationId: string; documentId: string; pdfPageIndex: number | null };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body;
}
const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The "Research threads" tab: build, order and export collections of passages. */
export function ThreadsSection({ active = true, onOpenAnnotation }: { active?: boolean; onOpenAnnotation?: (request: OpenAnnotationRequest) => void }) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [message, setMessage] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [exportStyle, setExportStyle] = useState("sbl-note");

  const loadList = useCallback(async () => {
    try { setThreads((await api<{ threads: ThreadSummary[] }>("/api/threads")).threads); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load threads."); }
  }, []);
  // The tools drawer stays mounted while closed, so refresh whenever it opens:
  // threads may have been created from the Ledger in the meantime.
  const detailId = detail?.id;
  useEffect(() => {
    if (!active) return;
    void loadList();
    if (detailId) {
      api<{ thread: ThreadDetail }>(`/api/threads?threadId=${encodeURIComponent(detailId)}`)
        .then((body) => setDetail(body.thread))
        .catch(() => setDetail(null));
    }
  }, [active, loadList, detailId]);

  async function run(action: () => Promise<void>) {
    setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "That did not work."); }
  }

  const openThread = (id: string) => run(async () => setDetail((await api<{ thread: ThreadDetail }>(`/api/threads?threadId=${encodeURIComponent(id)}`)).thread));
  const apply = async (promise: Promise<{ thread: ThreadDetail }>) => { setDetail((await promise).thread); void loadList(); };

  const createThread = () => run(async () => {
    if (!newTitle.trim()) { setMessage("Give the thread a title first."); return; }
    const { thread } = await api<{ thread: ThreadDetail }>("/api/threads", send("POST", { title: newTitle }));
    setNewTitle("");
    setDetail(thread);
    void loadList();
  });

  const move = (index: number, direction: -1 | 1) => run(async () => {
    if (!detail) return;
    const order = detail.items.map((item) => item.id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    await apply(api(`/api/threads/items`, send("PATCH", { threadId: detail.id, order })));
  });

  if (detail) {
    return (
      <div className="threadsSection">
        <button type="button" className="textAction" onClick={() => { setDetail(null); void loadList(); }}>← All threads</button>
        <label>Title<input defaultValue={detail.title} key={`t-${detail.id}`} onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== detail.title) void run(() => apply(api("/api/threads", send("PATCH", { threadId: detail.id, title: value })))); }} /></label>
        <label>What is this thread for?<textarea rows={2} defaultValue={detail.description} key={`d-${detail.id}`} onBlur={(event) => { if (event.target.value.trim() !== detail.description) void run(() => apply(api("/api/threads", send("PATCH", { threadId: detail.id, description: event.target.value })))); }} /></label>
        <label>Tags (comma separated)<input defaultValue={detail.tags.join(", ")} key={`g-${detail.id}`} onBlur={(event) => { const tags = event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean); if (tags.join("|") !== detail.tags.join("|")) void run(() => apply(api("/api/threads", send("PATCH", { threadId: detail.id, tags })))); }} /></label>

        <label>Footnote style for export
          <select value={exportStyle} onChange={(event) => setExportStyle(event.target.value)}>
            <option value="sbl-note">SBL (2nd edition)</option>
            <option value="chicago-note">Chicago notes</option>
            <option value="turabian-note">Turabian (Chicago form)</option>
          </select>
        </label>
        <div className="threadExport">
          <a className="secondaryButton" href={`/api/threads/export?threadId=${encodeURIComponent(detail.id)}&format=docx&style=${exportStyle}`}>Export to Word (with footnotes)</a>
          <a className="secondaryButton" href={`/api/threads/export?threadId=${encodeURIComponent(detail.id)}&format=markdown&style=${exportStyle}`}>Export to Markdown</a>
        </div>
        <p className="threadFine">Footnotes follow the style file: the first mention of a work is in full, later mentions are shortened, and a bibliography is added at the end.</p>

        {detail.items.length === 0 ? <p className="threadEmpty">Nothing in this thread yet. Use <strong>Add to thread</strong> on a saved record in the Ledger, or add a paragraph of your own below.</p> : null}
        <ol className="threadItems">
          {detail.items.map((item, index) => {
            const context = item.context;
            const color = context?.itemType === "ANNOTATION" ? highlightColors.find((entry) => entry.key === context.colorKey) ?? highlightColors[0] : null;
            return (
              <li key={item.id} className="threadItem">
                <div className="threadItemHead">
                  {color ? <span className="recordColor" style={{ background: color.color }} /> : null}
                  <strong>
                    {context === null ? "Missing item" : context.itemType === "ANNOTATION" ? context.documentTitle : context.itemType === "NOTE" ? "Your paragraph" : context.itemType === "DOCUMENT" ? context.documentTitle : context.itemType === "SOURCE" ? context.title : "Citation"}
                  </strong>
                  {context?.itemType === "ANNOTATION" && context.bookPage ? <span>book p. {context.bookPage}</span> : null}
                  <span className="threadItemButtons">
                    <button type="button" onClick={() => void move(index, -1)} disabled={index === 0} aria-label="Move up">↑</button>
                    <button type="button" onClick={() => void move(index, 1)} disabled={index === detail.items.length - 1} aria-label="Move down">↓</button>
                    <button type="button" onClick={() => void run(async () => apply(api(`/api/threads/items?threadId=${encodeURIComponent(detail.id)}&itemId=${encodeURIComponent(item.id)}`, { method: "DELETE" })))} aria-label="Remove from thread">Remove</button>
                  </span>
                </div>
                {context === null ? <p className="threadEmpty">The original was deleted. It will be skipped in exports.</p> : null}
                {context?.itemType === "ANNOTATION" ? <blockquote>{context.selectedText}</blockquote> : null}
                {context?.itemType === "ANNOTATION" && context.note ? <p className="threadOwnNote">Your note: {context.note}</p> : null}
                {context && "citationText" in context && context.citationText ? <p className="threadCitation">{context.citationText}</p> : null}
                <textarea
                  rows={item.itemType === "NOTE" ? 3 : 2}
                  defaultValue={item.note}
                  key={`${item.id}-${item.note}`}
                  placeholder={item.itemType === "NOTE" ? "Your paragraph" : "Add a note about how you will use this here"}
                  onBlur={(event) => { if (event.target.value.trim() !== item.note) void run(() => apply(api("/api/threads/items", send("PATCH", { threadId: detail.id, itemId: item.id, note: event.target.value })))); }}
                />
                {context?.itemType === "ANNOTATION" && onOpenAnnotation ? (
                  <button type="button" className="textAction" onClick={() => onOpenAnnotation({ annotationId: item.itemId, documentId: context.documentId, pdfPageIndex: context.pdfPageIndex })}>Go to this passage</button>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="threadAddNote">
          <label>Add a paragraph of your own<textarea rows={2} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} /></label>
          <button type="button" className="secondaryButton" disabled={!noteDraft.trim()} onClick={() => void run(async () => { await apply(api("/api/threads/items", send("POST", { threadId: detail.id, itemType: "NOTE", note: noteDraft }))); setNoteDraft(""); })}>Add paragraph</button>
        </div>
        <button type="button" className="textAction dangerAction" onClick={() => { if (window.confirm(`Delete the thread "${detail.title}"? The passages themselves are not deleted.`)) void run(async () => { await api(`/api/threads?threadId=${encodeURIComponent(detail.id)}`, { method: "DELETE" }); setDetail(null); await loadList(); }); }}>Delete this thread</button>
        {message ? <p className="threadMessage" role="alert">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="threadsSection">
      <p>A research thread collects passages from your reading, in the order you choose, and exports them to Word with each citation as a footnote.</p>
      <div className="threadNew">
        <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="New thread title, e.g. “The unity of the church”" onKeyDown={(event) => { if (event.key === "Enter") void createThread(); }} aria-label="New thread title" />
        <button type="button" className="primaryButton" onClick={() => void createThread()}>Create thread</button>
      </div>
      {threads === null ? <p>Loading…</p> : threads.length === 0 ? <p className="threadEmpty">No threads yet.</p> : (
        <ul className="threadList">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button type="button" onClick={() => void openThread(thread.id)}>
                <strong>{thread.title}</strong>
                <span>{thread.itemCount} item{thread.itemCount === 1 ? "" : "s"}{thread.tags.length ? ` · ${thread.tags.join(", ")}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {message ? <p className="threadMessage" role="alert">{message}</p> : null}
    </div>
  );
}

/** Small control on a Ledger record: put this passage into a thread. */
export function AddToThread({ annotationId, onResult }: { annotationId: string; onResult: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [chosen, setChosen] = useState("");
  const [title, setTitle] = useState("");

  async function show() {
    setOpen(true);
    try {
      const list = (await api<{ threads: ThreadSummary[] }>("/api/threads")).threads;
      setThreads(list);
      setChosen(list[0]?.id ?? "");
    } catch (error) { onResult(error instanceof Error ? error.message : "Could not load threads."); }
  }

  async function add() {
    try {
      let threadId = chosen;
      let name = threads.find((thread) => thread.id === chosen)?.title ?? "";
      if (title.trim()) {
        const created = await api<{ thread: ThreadDetail }>("/api/threads", send("POST", { title }));
        threadId = created.thread.id;
        name = created.thread.title;
      }
      if (!threadId) { onResult("Choose a thread or type a name for a new one."); return; }
      const result = await api<{ alreadyPresent: boolean }>("/api/threads/items", send("POST", { threadId, itemType: "ANNOTATION", itemId: annotationId }));
      onResult(result.alreadyPresent ? `Already in the thread “${name}”.` : `Added to the thread “${name}”.`);
      setOpen(false);
      setTitle("");
    } catch (error) { onResult(error instanceof Error ? error.message : "Could not add to the thread."); }
  }

  if (!open) return <button className="recordOpen" type="button" onClick={() => void show()}>Add to thread</button>;
  return (
    <div className="addToThread">
      {threads.length > 0 ? <select value={chosen} onChange={(event) => setChosen(event.target.value)} aria-label="Thread">{threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}</select> : null}
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={threads.length ? "…or a new thread name" : "Name the new thread"} aria-label="New thread name" />
      <span>
        <button type="button" className="recordOpen" onClick={() => void add()}>Add</button>{" "}
        <button type="button" className="recordOpen" onClick={() => setOpen(false)}>Cancel</button>
      </span>
    </div>
  );
}
