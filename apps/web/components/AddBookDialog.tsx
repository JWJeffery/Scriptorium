"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./library/Dialog";

// "Add a book": from this device, from a link, from Google Drive, or from Box. Every source ends the same way: a
// PDF File handed to onFile, which adds it exactly like a file chosen from the device (duplicate check, upload,
// browser copy). Google Drive and Box appear only when they are set up on the server (docs/CLOUD_IMPORT.md).

type Config = { google: { clientId: string; apiKey: string; appId: string | null } | null; box: { connected: boolean; account: string | null } | null };
type BoxListing = { folder: { id: string; name: string; parentId: string | null }; items: Array<{ id: string; type: "folder" | "file"; name: string; size: number | null }> };
type View = "menu" | "link" | "box";

async function fileFromResponse(response: Response, fallbackName: string) {
  if (!response.ok) {
    let message = `error ${response.status}`;
    try { message = ((await response.json()) as { error?: string }).error ?? message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const header = response.headers.get("x-scriptorium-filename");
  const name = header ? decodeURIComponent(header) : fallbackName;
  return new File([await response.blob()], name, { type: "application/pdf" });
}

const megabytes = (size: number | null) => (size === null ? "" : `${(size / 1024 / 1024).toFixed(size > 10 * 1024 * 1024 ? 0 : 1)} MB`);

export function AddBookDialog({ onClose, onFile, onPickDevice, startWith = "menu" }: { onClose: () => void; onFile: (file: File) => Promise<void> | void; onPickDevice: () => void; startWith?: View }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [view, setView] = useState<View>(startWith);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<BoxListing | null>(null);

  useEffect(() => {
    fetch("/api/import/config").then((r) => (r.ok ? r.json() : null)).then((value: Config | null) => setConfig(value ?? { google: null, box: null })).catch(() => setConfig({ google: null, box: null }));
  }, []);

  async function finish(file: File) {
    setBusy(`Adding "${file.name}"…`);
    try { await onFile(file); onClose(); } catch (problem) { setError(problem instanceof Error ? problem.message : "The book could not be added."); setBusy(null); }
  }

  async function addFromLink() {
    setError(null);
    if (!link.trim()) { setError("Paste a link first."); return; }
    setBusy("Fetching the PDF…");
    try {
      const response = await fetch("/api/import/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: link.trim() }) });
      await finish(await fileFromResponse(response, "book.pdf"));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The link could not be fetched.");
      setBusy(null);
    }
  }

  async function openBoxFolder(folderId: string) {
    setError(null);
    setBusy("Opening Box…");
    try {
      const response = await fetch(`/api/import/box/items?folder=${encodeURIComponent(folderId)}`);
      const body = await response.json() as BoxListing & { error?: string; connected?: boolean };
      if (!response.ok) {
        if (response.status === 401) setConfig((current) => current && current.box ? { ...current, box: { connected: false, account: null } } : current);
        throw new Error(body.error ?? "Box could not be opened.");
      }
      setListing(body);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Box could not be opened.");
    } finally {
      setBusy(null);
    }
  }

  async function addFromBox(id: string, name: string) {
    setError(null);
    setBusy(`Downloading "${name}" from Box…`);
    try { await finish(await fileFromResponse(await fetch(`/api/import/box/file/${encodeURIComponent(id)}`), name)); } catch (problem) { setError(problem instanceof Error ? problem.message : "The file could not be downloaded."); setBusy(null); }
  }

  async function disconnectBox() {
    await fetch("/api/import/box", { method: "DELETE" }).catch(() => undefined);
    setListing(null);
    setConfig((current) => current && current.box ? { ...current, box: { connected: false, account: null } } : current);
  }

  async function addFromGoogle() {
    if (!config?.google) return;
    setError(null);
    setBusy("Opening Google Drive…");
    try {
      const { pickFromGoogleDrive } = await import("../lib/google-drive-picker");
      const file = await pickFromGoogleDrive(config.google, () => setBusy("Downloading from Google Drive…"));
      if (!file) { setBusy(null); return; }
      await finish(file);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Google Drive could not be opened.");
      setBusy(null);
    }
  }

  useEffect(() => {
    if (view === "box" && config?.box?.connected && !listing && !busy) void openBoxFolder("0");
    // Opens the top folder once Box is known to be connected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, config]);

  return (
    <Dialog title="Add a book" onClose={onClose}>
      <div className="addBook">
        {view === "menu" ? (
          <div className="addBookOptions">
            <button type="button" className="addBookOption" onClick={() => { onClose(); onPickDevice(); }}><strong>From this device</strong><span>A PDF, TXT, Markdown or DOCX file. On a phone this also reaches Google Drive, Box and iCloud through the system picker.</span></button>
            <button type="button" className="addBookOption" onClick={() => { setError(null); setView("link"); }}><strong>From a link</strong><span>A Google Drive, Dropbox or Box share link, or any direct link to a PDF.</span></button>
            {config?.google ? <button type="button" className="addBookOption" onClick={() => void addFromGoogle()} disabled={Boolean(busy)}><strong>From Google Drive</strong><span>Choose a PDF in your Drive.</span></button> : null}
            {config?.box ? <button type="button" className="addBookOption" onClick={() => { setError(null); setView("box"); }}><strong>From Box</strong><span>{config.box.connected ? `Connected${config.box.account ? ` as ${config.box.account}` : ""}.` : "Sign in to Box once, then choose a PDF."}</span></button> : null}
            {config && (!config.google || !config.box) ? <p className="addBookHint">{!config.google && !config.box ? "Google Drive and Box can be added as sources" : !config.google ? "Google Drive can be added as a source" : "Box can be added as a source"} once they are set up on the server (docs/CLOUD_IMPORT.md).</p> : null}
          </div>
        ) : null}

        {view === "link" ? (
          <form className="addBookLink" onSubmit={(event) => { event.preventDefault(); void addFromLink(); }}>
            <label>Link to the PDF<input type="url" inputMode="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://drive.google.com/file/d/…" disabled={Boolean(busy)} /></label>
            <p className="addBookHint">For Google Drive, Dropbox and Box the file must be shared as &ldquo;Anyone with the link&rdquo;.</p>
            <div className="addBookActions"><button type="button" className="secondaryButton" onClick={() => setView("menu")} disabled={Boolean(busy)}>Back</button><button type="submit" className="primaryButton" disabled={Boolean(busy)}>Add</button></div>
          </form>
        ) : null}

        {view === "box" ? (
          <div className="addBookBox">
            {config?.box && !config.box.connected ? (
              <>
                <p>Sign in to Box once. Scriptorium can then list your folders and add the PDFs you choose. You can disconnect at any time.</p>
                <div className="addBookActions"><button type="button" className="secondaryButton" onClick={() => setView("menu")}>Back</button><a className="primaryButton" href="/api/import/box/start">Connect Box</a></div>
              </>
            ) : listing ? (
              <>
                <div className="addBookBoxHead">
                  {listing.folder.parentId !== null ? <button type="button" className="textAction" onClick={() => void openBoxFolder(listing.folder.parentId as string)} disabled={Boolean(busy)}>‹ Up</button> : null}
                  <strong>{listing.folder.name}</strong>
                </div>
                <ul className="addBookBoxList">
                  {listing.items.length === 0 ? <li className="addBookHint">No folders or PDFs here.</li> : null}
                  {listing.items.map((item) => (
                    <li key={`${item.type}-${item.id}`}>
                      <button type="button" disabled={Boolean(busy)} onClick={() => void (item.type === "folder" ? openBoxFolder(item.id) : addFromBox(item.id, item.name))}>
                        <span aria-hidden="true">{item.type === "folder" ? "📁" : "📄"}</span> {item.name} <small>{item.type === "file" ? megabytes(item.size) : ""}</small>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="addBookActions"><button type="button" className="secondaryButton" onClick={() => setView("menu")} disabled={Boolean(busy)}>Back</button><button type="button" className="textAction" onClick={() => void disconnectBox()}>Disconnect Box</button></div>
              </>
            ) : null}
          </div>
        ) : null}

        {busy ? <p className="addBookBusy" role="status">{busy}</p> : null}
        {error ? <p className="addBookError" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}
