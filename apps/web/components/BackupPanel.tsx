"use client";

import { useCallback, useEffect, useState } from "react";

type BackupInfo = { name: string; size: number; createdAt: string };

function sizeLabel(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : size < 1024 ** 3 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${(size / 1024 ** 3).toFixed(2)} GB`;
}

function ageLabel(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** Backup tab: a ZIP with the whole database and every stored PDF. */
export function BackupSection({ active = true }: { active?: boolean }) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/backup");
      const body = (await response.json()) as { backups: BackupInfo[]; directory: string };
      setBackups(body.backups);
      setDirectory(body.directory);
    } catch { setMessage("Could not load the list of backups."); }
  }, []);
  useEffect(() => { if (active) void load(); }, [active, load]);

  async function create() {
    setBusy(true);
    setMessage("Creating the backup. For a large library this can take a minute or two…");
    try {
      const response = await fetch("/api/backup", { method: "POST" });
      const body = (await response.json()) as { error?: string; name?: string; size?: number };
      setMessage(response.ok ? `Backup saved on the server: ${body.name} (${sizeLabel(body.size ?? 0)}).` : body.error ?? "The backup failed.");
      await load();
    } catch { setMessage("The backup failed."); }
    finally { setBusy(false); }
  }

  async function remove(name: string) {
    if (!window.confirm(`Delete the server copy ${name}? Downloaded copies are not affected.`)) return;
    const response = await fetch(`/api/backup?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    setMessage(response.ok ? "Deleted." : "That backup could not be deleted.");
    await load();
  }

  const newest = backups?.[0];
  return (
    <div className="backupSection">
      <p>
        A backup is one ZIP file holding <strong>everything</strong>: your documents, annotations, notes, tags, citations, page numbering and threads, plus every stored PDF.
        Keep at least one copy somewhere other than this server, such as your own computer.
      </p>
      <p className={newest && Date.now() - new Date(newest.createdAt).getTime() < 7 * 86_400_000 ? "backupStatus" : "backupStatus stale"}>
        {newest ? `Latest backup kept on the server: ${ageLabel(newest.createdAt)}.` : "No backup has been saved on the server yet."}
      </p>
      <div className="backupActions">
        <a className="primaryButton" href="/api/backup/download" download>Download a backup now</a>
        <button type="button" className="secondaryButton" onClick={() => void create()} disabled={busy}>{busy ? "Working…" : "Save a backup on the server"}</button>
      </div>
      {message ? <p className="inlineSaveNotice" role="status">{message}</p> : null}

      <h3>Saved on the server</h3>
      {backups === null ? <p>Loading…</p> : backups.length === 0 ? <p>None yet.</p> : (
        <ul className="backupList">
          {backups.map((backup) => (
            <li key={backup.name}>
              <span><strong>{backup.name}</strong><small>{new Date(backup.createdAt).toLocaleString()} · {sizeLabel(backup.size)}</small></span>
              <span>
                <a className="textAction" href={`/api/backup/download?name=${encodeURIComponent(backup.name)}`} download>Download</a>{" "}
                <button type="button" className="textAction dangerAction" onClick={() => void remove(backup.name)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {directory ? <p className="backupFine">Server copies are stored in <code>{directory}</code>. The newest 14 are kept.</p> : null}

      <h3>Restoring</h3>
      <p className="backupFine">
        Restoring is done from the terminal, into an empty database, and it checks every checksum first so a damaged file is refused:
      </p>
      <pre className="backupCode">node scripts/restore-backup.mjs path/to/scriptorium-backup-….zip</pre>
    </div>
  );
}
