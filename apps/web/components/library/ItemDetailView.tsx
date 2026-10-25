"use client";

import { useCallback, useEffect, useState } from "react";
import { AppNav } from "./AppNav";
import { Dialog } from "./Dialog";
import { TagInput } from "../TagInput";
import { highlightColors } from "../../lib/highlights";
import {
  ApiProblem, JOB_LABEL, STATE_LABEL, api, dateLabel, readerLink, sizeLabel,
  type CollectionSummary, type DeleteImpact, type ItemDetail, type ItemState, type JobSummary
} from "../../lib/library-client";

type Tab = "read" | "annotations" | "metadata" | "versions" | "relations" | "activity";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "read", label: "Read" }, { key: "annotations", label: "Annotations" }, { key: "metadata", label: "Metadata" },
  { key: "versions", label: "Versions" }, { key: "relations", label: "Relations" }, { key: "activity", label: "Activity" }
];

type AnnotationRow = { id: string; colorKey: string; selectedText: string; note: string | null; tags: string[]; pdfPage: number | null; bookPage: string | null; createdAt: string };

function names(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((entry: { literal?: string; given?: string; family?: string }) => entry.literal ?? [entry.given, entry.family].filter(Boolean).join(" ")).filter(Boolean).join("; ");
}

export function ItemDetailView({ id }: { id: string }) {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<Tab>("read");
  const [annotations, setAnnotations] = useState<AnnotationRow[] | null>(null);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItem(await api<ItemDetail>(`/api/v1/items/${id}`));
      setError("");
    } catch (reason) {
      setError(reason instanceof ApiProblem && reason.status === 404 ? "This book was not found. It may have been deleted." : reason instanceof Error ? reason.message : "The book could not be loaded.");
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api<{ collections: CollectionSummary[] }>("/api/v1/collections").then((body) => setCollections(body.collections)).catch(() => undefined); }, []);
  useEffect(() => {
    if (tab === "annotations" && annotations === null) api<{ annotations: AnnotationRow[] }>(`/api/v1/items/${id}/annotations`).then((body) => setAnnotations(body.annotations)).catch(() => setAnnotations([]));
    if (tab === "activity" && jobs === null && item) {
      Promise.all([...item.versions.map((version) => version.id), id].map((subject) => api<{ jobs: JobSummary[] }>(`/api/v1/jobs?subjectId=${subject}`).then((body) => body.jobs)))
        .then((lists) => setJobs(lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt))))
        .catch(() => setJobs([]));
    }
  }, [tab, annotations, jobs, item, id]);

  async function patch(body: Record<string, unknown>) {
    if (!item) return;
    try {
      await api(`/api/v1/items/${id}`, { method: "PATCH", body: { ...body, baseVersion: item.version } });
      await load();
      setMessage("Saved.");
    } catch (reason) {
      setMessage(reason instanceof ApiProblem && reason.status === 409 ? "This book was changed somewhere else; it has been reloaded. Try again." : reason instanceof Error ? reason.message : "It could not be saved.");
      await load();
    }
  }

  async function toggleCollection(collection: CollectionSummary, member: boolean) {
    try {
      await api(`/api/v1/collections/${collection.id}/items`, { method: member ? "DELETE" : "POST", body: { itemIds: [id] } });
      await load();
      setCollections((await api<{ collections: CollectionSummary[] }>("/api/v1/collections")).collections);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The collection could not be changed."); }
  }

  async function askDelete() {
    try { setImpact(await api<DeleteImpact>(`/api/v1/items/${id}/impact`)); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The effect of deleting could not be worked out."); }
  }

  async function confirmDelete() {
    try { await api(`/api/v1/items/${id}`, { method: "DELETE" }); window.location.assign("/library?view=deleted"); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "It could not be deleted."); setImpact(null); }
  }

  async function restore() {
    try { await api(`/api/v1/items/${id}/restore`, { method: "POST" }); await load(); setMessage("Restored."); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "It could not be restored."); }
  }

  if (error) return <div className="libPage"><AppNav current="library" /><main className="libDetail"><p className="libMessage" role="alert">{error}</p><p><a href="/library">Back to the library</a></p></main></div>;
  if (!item) return <div className="libPage"><AppNav current="library" /><main className="libDetail"><p className="libFaint">Loading…</p></main></div>;

  const deleted = Boolean(item.deletedAt);
  const csl = (item.cslJson ?? {}) as Record<string, unknown>;
  const issued = (csl.issued as { "date-parts"?: unknown[][] } | undefined)?.["date-parts"]?.[0]?.[0];
  const metadata: Array<[string, string]> = [
    ["Title", typeof csl.title === "string" ? csl.title : item.title],
    ["Author", names(csl.author)],
    ["Editor", names(csl.editor)],
    ["Container", typeof csl["container-title"] === "string" ? csl["container-title"] : ""],
    ["Publisher", typeof csl.publisher === "string" ? csl.publisher : ""],
    ["Place", typeof csl["publisher-place"] === "string" ? csl["publisher-place"] : ""],
    ["Year", issued === undefined ? "" : String(issued)],
    ["DOI", typeof csl.DOI === "string" ? csl.DOI : ""],
    ["ISBN", typeof csl.ISBN === "string" ? csl.ISBN : ""],
    ["Type", typeof csl.type === "string" ? csl.type : ""]
  ];

  return (
    <div className="libPage">
      <AppNav current="library"><a href="/library">← Library</a></AppNav>
      <main className="libDetail">
        {deleted ? <p className="libMessage" role="status">This book was deleted {dateLabel(item.deletedAt)}. <button type="button" onClick={() => void restore()}>Restore it</button></p> : null}
        <header className="libDetailHead">
          <div>
            {title === null ? (
              <h1>{item.title} <button type="button" className="libTiny" aria-label="Rename" onClick={() => setTitle(item.title)}>✎</button></h1>
            ) : (
              <form className="libInline" onSubmit={(event) => { event.preventDefault(); if (title.trim()) void patch({ title: title.trim() }).then(() => setTitle(null)); }}>
                <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Title" autoFocus />
                <button type="submit">Save</button><button type="button" onClick={() => setTitle(null)}>Cancel</button>
              </form>
            )}
            <p className="libFaint">{item.contributor ?? "Author unknown"} · {item.kind}{item.filename ? ` · ${item.filename}` : ""} · added {dateLabel(item.acceptedAt)}</p>
          </div>
          <div className="libDetailActions">
            {!deleted ? <a className="libButton primary" href={readerLink(item.id)}>Open in the reader</a> : null}
            {!deleted ? <button type="button" className="libDanger" onClick={() => void askDelete()}>Delete…</button> : null}
          </div>
        </header>

        {message ? <p className="libMessage" role="status">{message}</p> : null}

        {!deleted ? (
          <section className="libFacts" aria-label="Organise">
            <label>State
              <select value={item.state} onChange={(event) => void patch({ state: event.target.value })}>
                {(Object.keys(STATE_LABEL) as ItemState[]).map((state) => <option key={state} value={state}>{STATE_LABEL[state]}</option>)}
              </select>
            </label>
            <label className="libCheck"><input type="checkbox" checked={item.favorite} onChange={(event) => void patch({ favorite: event.target.checked })} /> Favorite</label>
            <div className="libFactWide"><span>Tags</span><TagInput value={item.tags} suggestions={[]} onChange={(tags) => void patch({ tags: tags.map((entry) => entry.toLowerCase()) })} /></div>
            <div className="libFactWide">
              <span>Collections</span>
              {collections.length === 0 ? <em className="libFaint">None yet. Create one from the Library.</em> : (
                <span className="libTags">
                  {collections.map((collection) => {
                    const member = item.collections.some((entry) => entry.id === collection.id);
                    return <button type="button" key={collection.id} className="libChip" aria-pressed={member} onClick={() => void toggleCollection(collection, member)}>{member ? "✓ " : "+ "}{collection.name}</button>;
                  })}
                </span>
              )}
            </div>
          </section>
        ) : null}

        <div role="tablist" aria-label="About this book" className="libTabs">
          {TABS.map((entry) => <button key={entry.key} role="tab" type="button" aria-selected={tab === entry.key} onClick={() => setTab(entry.key)}>{entry.label}</button>)}
        </div>

        <section role="tabpanel" className="libPanel">
          {tab === "read" ? (
            <div>
              <p>{item.progress.lastPage ? <>You were on page <strong>{item.progress.lastPage}</strong>{item.progress.pageCount ? <> of {item.progress.pageCount}</> : null} ({item.progress.percent}%){item.lastOpenedAt ? <>, last opened {dateLabel(item.lastOpenedAt)}</> : null}.</> : "Not started yet."}</p>
              <progress max={100} value={item.progress.percent} aria-label={`${item.progress.percent}% read`} />
              <p className="libFaint">{item.preservation.originalMissing ? "The stored file is missing from the server; open the reader to see what can still be recovered." : item.preservation.originalStored ? `Original stored (${sizeLabel(item.preservation.sizeBytes)}).` : "No original file is stored for this item; its text snapshot is kept."}</p>
            </div>
          ) : null}

          {tab === "annotations" ? (
            annotations === null ? <p className="libFaint">Loading…</p> : annotations.length === 0 ? <p className="libEmpty">No highlights or notes yet. Open the book in the reader and select text to add one.</p> : (
              <ul className="libNotes">
                {annotations.map((entry) => {
                  const color = highlightColors.find((candidate) => candidate.key === entry.colorKey);
                  return (
                    <li key={entry.id}>
                      <span className="libSwatch" style={{ background: color?.color ?? "#ddd" }} role="img" aria-label={color?.defaultMeaning ?? entry.colorKey} />
                      <div>
                        <blockquote>{entry.selectedText}</blockquote>
                        {entry.note ? <p>{entry.note}</p> : null}
                        <small>{color?.defaultMeaning ?? entry.colorKey}{entry.bookPage ? ` · book p. ${entry.bookPage}` : entry.pdfPage ? ` · PDF p. ${entry.pdfPage}` : ""}{entry.tags.length ? ` · ${entry.tags.join(", ")}` : ""}</small>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}

          {tab === "metadata" ? (
            <div>
              <dl className="libMeta">
                {metadata.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
              {metadata.every(([label, value]) => !value || label === "Title" || label === "Type") ? <p className="libWarn">No author or publication details yet. Add them in the reader under Scholarly tools → Expanded citation source, or look them up by ISBN or DOI.</p> : null}
              <p className="libFaint">To change these, use the reader: Scholarly tools → Expanded citation source.</p>
            </div>
          ) : null}

          {tab === "versions" ? (
            <table className="libTable compact">
              <thead><tr><th scope="col">Added</th><th scope="col">Kind</th><th scope="col">Fingerprint (SHA-256)</th><th scope="col">Text pages</th><th scope="col">Notes</th><th scope="col">Extraction</th></tr></thead>
              <tbody>
                {item.versions.map((version) => (
                  <tr key={version.id}>
                    <td data-label="Added">{dateLabel(version.createdAt)}</td><td data-label="Kind">{version.snapshotKind}</td>
                    <td data-label="Fingerprint">{version.checksum ? <code title={version.checksum}>{version.checksum.slice(0, 16)}…</code> : <span className="libFaint">not recorded</span>}</td>
                    <td data-label="Text pages">{version.segments}</td><td data-label="Notes">{version.annotations}</td><td data-label="Extraction">{version.extraction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {tab === "relations" ? <p className="libEmpty">No related items yet. Editions, translations, reviews and replies will be linked here in a later phase.</p> : null}

          {tab === "activity" ? (
            jobs === null ? <p className="libFaint">Loading…</p> : (
              <ul className="libNotes">
                <li><div><strong>Added to the library</strong><br /><small>{dateLabel(item.acceptedAt)}</small></div></li>
                {item.lastOpenedAt ? <li><div><strong>Last opened</strong><br /><small>{dateLabel(item.lastOpenedAt)}</small></div></li> : null}
                {jobs.map((job) => <li key={job.id}><div><strong>{JOB_LABEL[job.type] ?? job.type}</strong> — {job.state}{job.error ? `: ${job.error}` : ""}<br /><small>{dateLabel(job.createdAt)}{job.attempts > 1 ? ` · ${job.attempts} attempts` : ""}</small></div></li>)}
              </ul>
            )
          ) : null}
        </section>
      </main>

      {impact ? (
        <Dialog title="Delete this book?" onClose={() => setImpact(null)} wide>
          <p>“{impact.title}” will leave your library and search. It can be restored, with everything below.</p>
          <ul className="libImpact"><li><span>{impact.annotations} notes and highlights · {impact.citations} citations · {impact.bookmarks} bookmarks · in {impact.collections} collections · {impact.versions} stored {impact.versions === 1 ? "version" : "versions"}{impact.threadReferences ? ` · used in ${impact.threadReferences} research thread ${impact.threadReferences === 1 ? "entry" : "entries"}` : ""}</span></li></ul>
          <div className="libDialogActions"><button type="button" onClick={() => setImpact(null)}>Cancel</button><button type="button" className="libDanger" onClick={() => void confirmDelete()}>Delete</button></div>
        </Dialog>
      ) : null}
    </div>
  );
}
