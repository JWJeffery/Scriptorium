"use client";

import { useEffect, useState } from "react";

type Health = { state: "not-applicable" | "ok" } | { state: "attention"; reason: string };

// A quiet banner that appears only when the off-server backups need attention (failed, stale, or Google Drive not
// connected). It can be hidden for the rest of the day.
const DISMISS_KEY = "scriptorium.backupWarning.dismissedOn";

export function BackupWarning() {
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.pathname.startsWith("/login")) return;
    let today = "";
    try { today = new Date().toISOString().slice(0, 10); if (localStorage.getItem(DISMISS_KEY) === today) return; } catch { /* storage unavailable */ }
    const controller = new AbortController();
    fetch("/api/system/backup-status", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((health: Health | null) => { if (health?.state === "attention") setReason(health.reason); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!reason) return null;
  return (
    <div className="backupWarning" role="status">
      <strong>Backups need attention.</strong> <span>{reason}</span>
      <button type="button" onClick={() => { try { localStorage.setItem(DISMISS_KEY, new Date().toISOString().slice(0, 10)); } catch { /* ignore */ } setReason(null); }} aria-label="Hide until tomorrow">Hide today</button>
    </div>
  );
}
