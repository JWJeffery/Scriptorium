"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "./AppNav";
import { Dialog } from "./Dialog";
import {
  ApiProblem, STATE_LABEL, VIEWS, api, dateLabel, readerLink, sizeLabel,
  type CollectionSummary, type DeleteImpact, type ItemState, type ItemSummary, type SavedSearchSummary
} from "../../lib/library-client";

type Dialogs =
  | { kind: "delete"; impacts: DeleteImpact[] }
  | { kind: "collection" }
  | { kind: "tag" }
  | { kind: "duplicates"; groups: Array<{ checksum: string; items: Array<{ id: string; title: string }> }>; busy?: string }
  | { kind: "saveSearch" }
  | null;

const PAGE = 25;

export function LibraryView() {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") ?? "all";
  const q = params.get("q") ?? "";
  const tag = params.get("tag") ?? "";
  const collectionId = params.get("collection") ?? "";
  const savedId = params.get("saved") ?? "";

  const [items, setItems] = useState<ItemSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [saved, setSaved] = useState<SavedSearchSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [qDraft, setQDraft] = useState(q);
  const [duplicateGroups, setDuplicateGroups] = useState(0);
  const [newCollection, setNewCollection] = useState("");
  const latest = useRef(0);

  // Each choice of view, collection or tag is a history entry, so the browser's Back button returns to the
  // previous list. Typing in the search box only replaces the entry, so it does not fill the history.
  const setFilters = useCallback((patch: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    const target = `/library${next.toString() ? `?${next}` : ""}`;
    if (replace) router.replace(target, { scroll: false });
    else router.push(target, { scroll: false });
  }, [params, router]);

  const buildQuery = useCallback((cursor?: string) => {
    const query = new URLSearchParams({ limit: String(PAGE), view });
    if (q) query.set("q", q);
    if (tag) query.set("tag", tag);
    if (collectionId) query.set("collectionId", collectionId);
    if (savedId) query.set("savedSearchId", savedId);
    if (cursor) query.set("cursor", cursor);
    return query.toString();
  }, [view, q, tag, collectionId, savedId]);

  const load = useCallback(async (more = false, cursor?: string) => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const body = await api<{ items: ItemSummary[]; nextCursor: string | null; total: number }>(`/api/v1/items?${buildQuery(cursor)}`);
      if (ticket !== latest.current) return; // a newer request has taken over
      setItems((current) => (more ? [...current, ...body.items.filter((item) => !current.some((existing) => existing.id === item.id))] : body.items));
      setNextCursor(body.nextCursor);
      setTotal(body.total);
      if (!more) setSelected(new Set());
    } catch (error) {
      if (ticket === latest.current) setMessage(error instanceof Error ? error.message : "The library could not be loaded.");
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [buildQuery]);

  const loadSides = useCallback(async () => {
    try {
      const [collectionBody, savedBody, duplicateBody] = await Promise.all([
        api<{ collections: CollectionSummary[] }>("/api/v1/collections"),
        api<{ savedSearches: SavedSearchSummary[] }>("/api/v1/saved-searches"),
        api<{ groups: unknown[] }>("/api/v1/items/duplicates")
      ]);
      setCollections(collectionBody.collections);
      setSaved(savedBody.savedSearches);
      setDuplicateGroups(duplicateBody.groups.length);
    } catch {
      // The side panels are a convenience; the list itself reports its own errors.
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // A confirmation stays until the person moves to a different view.
  useEffect(() => setMessage(""), [view, q, tag, collectionId, savedId]);
  useEffect(() => { void loadSides(); }, [loadSides]);
  useEffect(() => setQDraft(q), [q]);
  useEffect(() => {
    if (qDraft === q) return;
    const timer = window.setTimeout(() => setFilters({ q: qDraft, saved: "" }, true), 300);
    return () => window.clearTimeout(timer);
  }, [qDraft, q, setFilters]);

  const replaceItem = (updated: ItemSummary) => setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));

  async function patch(item: ItemSummary, body: Record<string, unknown>) {
    try {
      replaceItem(await api<ItemSummary>(`/api/v1/items/${item.id}`, { method: "PATCH", body: { ...body, baseVersion: item.version } }));
    } catch (error) {
      setMessage(error instanceof ApiProblem && error.status === 409 ? "That book was changed somewhere else; the list has been refreshed." : error instanceof Error ? error.message : "The change could not be saved.");
      void load();
    }
  }

  const chosen = items.filter((item) => selected.has(item.id));
  const allSelected = items.length > 0 && chosen.length === items.length;

  async function batch(body: Record<string, unknown> | ((item: ItemSummary) => Record<string, unknown>), done: string) {
    try {
      for (const item of chosen) await api(`/api/v1/items/${item.id}`, { method: "PATCH", body: typeof body === "function" ? body(item) : body });
      setMessage(done);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The change could not be saved.");
    }
  }

  async function askDelete() {
    try {
      const impacts = await Promise.all(chosen.map((item) => api<DeleteImpact>(`/api/v1/items/${item.id}/impact`)));
      setDialog({ kind: "delete", impacts });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The effect of deleting could not be worked out.");
    }
  }

  async function confirmDelete(impacts: DeleteImpact[]) {
    try {
      for (const impact of impacts) await api(`/api/v1/items/${impact.id}`, { method: "DELETE" });
      setDialog(null);
      setMessage(`${impacts.length} ${impacts.length === 1 ? "book" : "books"} deleted. Find ${impacts.length === 1 ? "it" : "them"} under Deleted to restore.`);
      await load();
      void loadSides();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The delete could not be completed.");
    }
  }

  async function restore(item: ItemSummary) {
    try {
      await api(`/api/v1/items/${item.id}/restore`, { method: "POST" });
      setMessage(`"${item.title}" was restored.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "It could not be restored.");
    }
  }

  async function addToCollection(collectionTarget: string, name?: string) {
    try {
      const id = collectionTarget || (await api<CollectionSummary>("/api/v1/collections", { method: "POST", body: { name } })).id;
      const result = await api<{ added: number; alreadyMembers: number }>(`/api/v1/collections/${id}/items`, { method: "POST", body: { itemIds: chosen.map((item) => item.id) } });
      setDialog(null);
      setMessage(`${result.added} added${result.alreadyMembers ? `, ${result.alreadyMembers} already there` : ""}.`);
      await Promise.all([load(), loadSides()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The collection could not be updated.");
    }
  }

  async function createCollection() {
    const name = newCollection.trim();
    if (!name) return;
    try {
      const created = await api<CollectionSummary>("/api/v1/collections", { method: "POST", body: { name } });
      setNewCollection("");
      await loadSides();
      setFilters({ collection: created.id, saved: "" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The collection could not be created.");
    }
  }

  async function renameCollection(collection: CollectionSummary) {
    const name = window.prompt("New name for this collection:", collection.name)?.trim();
    if (!name || name === collection.name) return;
    try { await api(`/api/v1/collections/${collection.id}`, { method: "PATCH", body: { name } }); await loadSides(); } catch (error) { setMessage(error instanceof Error ? error.message : "It could not be renamed."); }
  }

  async function removeCollection(collection: CollectionSummary) {
    if (!window.confirm(`Remove the collection "${collection.name}"?\n\nThe ${collection.itemCount} ${collection.itemCount === 1 ? "book stays" : "books stay"} in your library; only the grouping goes.`)) return;
    try {
      await api(`/api/v1/collections/${collection.id}`, { method: "DELETE" });
      if (collectionId === collection.id) setFilters({ collection: "" });
      await Promise.all([loadSides(), load()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "It could not be removed."); }
  }

  async function saveCurrentSearch(name: string) {
    try {
      await api("/api/v1/saved-searches", { method: "POST", body: { name, query: { view, ...(q ? { q } : {}), ...(tag ? { tag } : {}), ...(collectionId ? { collectionId } : {}) } } });
      setDialog(null);
      setMessage(`Saved "${name}". It re-runs every time you open it.`);
      await loadSides();
    } catch (error) { setMessage(error instanceof Error ? error.message : "It could not be saved."); }
  }

  async function removeSaved(search: SavedSearchSummary) {
    try { await api(`/api/v1/saved-searches/${search.id}`, { method: "DELETE" }); if (savedId === search.id) setFilters({ saved: "" }); await loadSides(); } catch (error) { setMessage(error instanceof Error ? error.message : "It could not be removed."); }
  }

  async function openDuplicates() {
    try {
      const body = await api<{ groups: Array<{ checksum: string; items: Array<{ id: string; title: string }> }> }>("/api/v1/items/duplicates");
      setDialog({ kind: "duplicates", groups: body.groups });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Duplicates could not be checked."); }
  }

  async function checkOlderBooks() {
    setDialog((current) => (current?.kind === "duplicates" ? { ...current, busy: "Reading the older files…" } : current));
    try {
      const body = await api<{ checked: number; updated: number; missingFile: number; groups: Array<{ checksum: string; items: Array<{ id: string; title: string }> }> }>("/api/v1/items/duplicates", { method: "POST" });
      setDuplicateGroups(body.groups.length);
      setDialog({ kind: "duplicates", groups: body.groups, busy: `Checked ${body.checked} older ${body.checked === 1 ? "book" : "books"}${body.missingFile ? `; ${body.missingFile} could not be read because the file is missing` : ""}.` });
    } catch (error) { setMessage(error instanceof Error ? error.message : "The check failed."); setDialog(null); }
  }

  const heading = savedId ? saved.find((search) => search.id === savedId)?.name ?? "Saved search" : collectionId ? collections.find((collection) => collection.id === collectionId)?.name ?? "Collection" : VIEWS.find((entry) => entry.key === view)?.label ?? "Library";
  const filtered = Boolean(q || tag || collectionId || view !== "all") && !savedId;
  const deletedView = view === "deleted";

  return (
    <div className="libPage">
      <AppNav current="library" />
      <div className="libLayout">
        <aside className="libSide" aria-label="Views and collections">
          <h2>Views</h2>
          <ul>
            {VIEWS.map((entry) => (
              <li key={entry.key}>
                <button type="button" aria-current={!savedId && !collectionId && view === entry.key ? "true" : undefined} onClick={() => setFilters({ view: entry.key === "all" ? "" : entry.key, collection: "", saved: "", tag: "" })}>{entry.label}</button>
              </li>
            ))}
          </ul>
          <h2>Collections</h2>
          <ul>
            {collections.map((collection) => (
              <li key={collection.id} className="libRowWithTools">
                <button type="button" aria-current={collectionId === collection.id ? "true" : undefined} onClick={() => setFilters({ collection: collection.id, view: "", saved: "", tag: "" })}>{collection.name}<span>{collection.itemCount}</span></button>
                <button type="button" className="libTiny" aria-label={`Rename ${collection.name}`} onClick={() => void renameCollection(collection)}>✎</button>
                <button type="button" className="libTiny" aria-label={`Remove collection ${collection.name}`} onClick={() => void removeCollection(collection)}>✕</button>
              </li>
            ))}
            {collections.length === 0 ? <li className="libHint">A collection groups books without copying them. Select books, then choose Add to collection.</li> : null}
          </ul>
          <form className="libInline" onSubmit={(event) => { event.preventDefault(); void createCollection(); }}>
            <input value={newCollection} onChange={(event) => setNewCollection(event.target.value)} placeholder="New collection" aria-label="New collection name" />
            <button type="submit" disabled={!newCollection.trim()}>Add</button>
          </form>
          <h2>Saved searches</h2>
          <ul>
            {saved.map((search) => (
              <li key={search.id} className="libRowWithTools">
                <button type="button" aria-current={savedId === search.id ? "true" : undefined} onClick={() => setFilters({ saved: search.id, view: "", collection: "", q: "", tag: "" })}>{search.name}</button>
                <button type="button" className="libTiny" aria-label={`Remove saved search ${search.name}`} onClick={() => void removeSaved(search)}>✕</button>
              </li>
            ))}
            {saved.length === 0 ? <li className="libHint">Filter the list, then Save this view to keep it. It stays up to date by itself.</li> : null}
          </ul>
        </aside>

        <main className="libMain">
          <div className="libHeading">
            <h1>{heading}</h1>
            <span className="libCount" aria-live="polite">{loading && items.length === 0 ? "Loading…" : `${total} ${total === 1 ? "book" : "books"}`}</span>
          </div>
          <div className="libToolbar">
            <input type="search" value={qDraft} onChange={(event) => setQDraft(event.target.value)} placeholder="Search titles, file names and tags" aria-label="Search the library" />
            {tag ? <button type="button" className="libChip" onClick={() => setFilters({ tag: "" })}>tag: {tag} ✕</button> : null}
            {filtered ? <button type="button" onClick={() => setDialog({ kind: "saveSearch" })}>Save this view</button> : null}
            {duplicateGroups > 0 ? <button type="button" className="libWarn" onClick={() => void openDuplicates()}>{duplicateGroups} {duplicateGroups === 1 ? "set" : "sets"} of identical files</button> : <button type="button" onClick={() => void openDuplicates()}>Check for duplicates</button>}
            <Link className="libButton" href="/">Add a book in the reader</Link>
          </div>

          {message ? <p className="libMessage" role="status">{message}</p> : null}

          {chosen.length > 0 ? (
            <div className="libBatch" role="region" aria-label="Selected books">
              <strong>{chosen.length} selected</strong>
              {deletedView ? (
                <button type="button" onClick={async () => { for (const item of chosen) await restore(item); }}>Restore</button>
              ) : (
                <>
                  <select aria-label="Set state of selected books" value="" onChange={(event) => { if (event.target.value) void batch({ state: event.target.value }, `Moved ${chosen.length} to ${STATE_LABEL[event.target.value as ItemState]}.`); }}>
                    <option value="">Move to…</option>
                    {(Object.keys(STATE_LABEL) as ItemState[]).map((state) => <option key={state} value={state}>{STATE_LABEL[state]}</option>)}
                  </select>
                  <button type="button" onClick={() => void batch({ favorite: true }, "Marked as favorites.")}>★ Favorite</button>
                  <button type="button" onClick={() => setDialog({ kind: "collection" })}>Add to collection…</button>
                  <button type="button" onClick={() => setDialog({ kind: "tag" })}>Add tag…</button>
                  <button type="button" className="libDanger" onClick={() => void askDelete()}>Delete…</button>
                </>
              )}
              <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          ) : null}

          {items.length === 0 && !loading ? (
            <p className="libEmpty">
              {deletedView ? "Nothing has been deleted." : filtered || savedId ? "No books match. Clear a filter to see more." : "Your library is empty. Open the reader and use Register source to add your first book."}
            </p>
          ) : (
            <table className="libTable">
              <thead>
                <tr>
                  <th scope="col"><input type="checkbox" aria-label="Select all shown" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(items.map((item) => item.id)) : new Set())} /></th>
                  <th scope="col"><span className="srOnly">Favorite</span></th>
                  <th scope="col">Title</th>
                  <th scope="col">Author</th>
                  <th scope="col">State</th>
                  <th scope="col">Collections</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Notes</th>
                  <th scope="col">Stored file</th>
                  <th scope="col">Added</th>
                  <th scope="col"><span className="srOnly">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} data-selected={selected.has(item.id) || undefined}>
                    <td data-label="Select"><input type="checkbox" aria-label={`Select ${item.title}`} checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /></td>
                    <td data-label="Favorite"><button type="button" className="libStar" aria-pressed={item.favorite} aria-label={item.favorite ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`} disabled={deletedView} onClick={() => void patch(item, { favorite: !item.favorite })}>{item.favorite ? "★" : "☆"}</button></td>
                    <td data-label="Title" className="libTitleCell">
                      <a href={`/items/${item.id}`}>{item.title}</a>
                      <small>{item.kind}{item.filename && item.filename !== item.title ? ` · ${item.filename}` : ""}</small>
                      {item.tags.length ? <span className="libTags">{item.tags.map((entry) => <button type="button" key={entry} className="libChip" onClick={() => setFilters({ tag: entry, saved: "" })}>{entry}</button>)}</span> : null}
                    </td>
                    <td data-label="Author">{item.contributor ?? <span className="libFaint">unknown</span>}</td>
                    <td data-label="State">
                      {deletedView ? <span className="libFaint">Deleted {dateLabel(item.deletedAt)}</span> : (
                        <select aria-label={`State of ${item.title}`} value={item.state} onChange={(event) => void patch(item, { state: event.target.value })}>
                          {(Object.keys(STATE_LABEL) as ItemState[]).map((state) => <option key={state} value={state}>{STATE_LABEL[state]}</option>)}
                        </select>
                      )}
                    </td>
                    <td data-label="Collections">{item.collections.length ? item.collections.map((collection) => <button type="button" key={collection.id} className="libChip" onClick={() => setFilters({ collection: collection.id, view: "", saved: "" })}>{collection.name}</button>) : <span className="libFaint">—</span>}</td>
                    <td data-label="Progress">
                      {item.progress.lastPage ? (
                        <span className="libProgress" title={`Page ${item.progress.lastPage}${item.progress.pageCount ? ` of ${item.progress.pageCount}` : ""}`}>
                          <progress max={100} value={item.progress.percent} aria-label={`${item.progress.percent}% read`} />
                          <span>{item.progress.percent}%</span>
                        </span>
                      ) : <span className="libFaint">not started</span>}
                    </td>
                    <td data-label="Notes">{item.annotationCount || <span className="libFaint">0</span>}</td>
                    <td data-label="Stored file">
                      {item.preservation.originalMissing ? <span className="libBad">File missing</span> : item.preservation.originalStored ? <span>{sizeLabel(item.preservation.sizeBytes)}</span> : <span className="libFaint">text only</span>}
                    </td>
                    <td data-label="Added">{dateLabel(item.acceptedAt)}</td>
                    <td data-label="Actions" className="libActions">
                      {deletedView ? <button type="button" onClick={() => void restore(item)}>Restore</button> : <a className="libButton" href={readerLink(item.id)}>Read</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {nextCursor ? <div className="libMore"><button type="button" disabled={loading} onClick={() => void load(true, nextCursor)}>{loading ? "Loading…" : `Show more (${total - items.length} left)`}</button></div> : null}
        </main>
      </div>

      {dialog?.kind === "delete" ? (
        <Dialog title="Delete from your library?" onClose={() => setDialog(null)} wide>
          <p>These books will leave your library and search. Nothing is erased: each can be restored from <strong>Deleted</strong>, with all its notes.</p>
          <ul className="libImpact">
            {dialog.impacts.map((impact) => (
              <li key={impact.id}>
                <strong>{impact.title}</strong>
                <span>{impact.annotations} {impact.annotations === 1 ? "note or highlight" : "notes and highlights"}, {impact.citations} {impact.citations === 1 ? "citation" : "citations"}, {impact.bookmarks} {impact.bookmarks === 1 ? "bookmark" : "bookmarks"}, in {impact.collections} {impact.collections === 1 ? "collection" : "collections"}{impact.threadReferences ? `, used in ${impact.threadReferences} research ${impact.threadReferences === 1 ? "thread entry" : "thread entries"}` : ""}</span>
              </li>
            ))}
          </ul>
          <div className="libDialogActions"><button type="button" onClick={() => setDialog(null)}>Cancel</button><button type="button" className="libDanger" onClick={() => void confirmDelete(dialog.impacts)}>Delete {dialog.impacts.length} {dialog.impacts.length === 1 ? "book" : "books"}</button></div>
        </Dialog>
      ) : null}

      {dialog?.kind === "collection" ? <CollectionDialog collections={collections} count={chosen.length} onClose={() => setDialog(null)} onChoose={(id, name) => void addToCollection(id, name)} /> : null}

      {dialog?.kind === "tag" ? (
        <TextDialog title="Add a tag to the selected books" label="Tag" action="Add tag" onClose={() => setDialog(null)} onSubmit={(value) => { setDialog(null); void batch((item) => ({ tags: Array.from(new Set([...item.tags, value.toLowerCase()])) }), `Tagged ${chosen.length} ${chosen.length === 1 ? "book" : "books"} “${value.toLowerCase()}”.`); }} />
      ) : null}

      {dialog?.kind === "saveSearch" ? <TextDialog title="Save this view" label="Name" action="Save" onClose={() => setDialog(null)} onSubmit={(value) => void saveCurrentSearch(value)} /> : null}

      {dialog?.kind === "duplicates" ? (
        <Dialog title="Identical files" onClose={() => setDialog(null)} wide>
          {dialog.groups.length === 0 ? <p>No two books have the same file.</p> : (
            <>
              <p>Each set below is the same file added more than once. Open each and delete the extra copy you do not want; nothing is removed automatically.</p>
              <ul className="libImpact">
                {dialog.groups.map((group) => (
                  <li key={group.checksum}>{group.items.map((entry) => <a key={entry.id} href={`/items/${entry.id}`}>{entry.title}</a>)}</li>
                ))}
              </ul>
            </>
          )}
          <p className="libHint">Books added before this check existed may not be compared yet.</p>
          <div className="libDialogActions">
            <span aria-live="polite">{dialog.busy}</span>
            <button type="button" onClick={() => void checkOlderBooks()}>Check older books</button>
            <button type="button" onClick={() => setDialog(null)}>Close</button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function TextDialog({ title, label, action, onClose, onSubmit }: { title: string; label: string; action: string; onClose: () => void; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
        <label className="libField">{label}<input value={value} onChange={(event) => setValue(event.target.value)} /></label>
        <div className="libDialogActions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!value.trim()}>{action}</button></div>
      </form>
    </Dialog>
  );
}

function CollectionDialog({ collections, count, onClose, onChoose }: { collections: CollectionSummary[]; count: number; onClose: () => void; onChoose: (existingId: string, newName?: string) => void }) {
  const [choice, setChoice] = useState(collections[0]?.id ?? "");
  const [name, setName] = useState("");
  return (
    <Dialog title={`Add ${count} ${count === 1 ? "book" : "books"} to a collection`} onClose={onClose}>
      {collections.length > 0 ? (
        <label className="libField">Existing collection
          <select value={choice} onChange={(event) => setChoice(event.target.value)}>
            {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name} ({collection.itemCount})</option>)}
          </select>
        </label>
      ) : null}
      <label className="libField">…or a new one<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Collection name" /></label>
      <div className="libDialogActions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" onClick={() => (name.trim() ? onChoose("", name.trim()) : onChoose(choice))} disabled={!name.trim() && !choice}>Add</button>
      </div>
    </Dialog>
  );
}
