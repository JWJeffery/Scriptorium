import { readFile } from "node:fs/promises";

// What deploy/backup.sh last reported (it writes SCRIPTORIUM_BACKUP_STATUS_FILE into the data volume), and whether
// that needs the owner's attention. Only production sets SCRIPTORIUM_BACKUP_STATUS_FILE; elsewhere backups are not
// this app's concern and nothing is reported.
export type BackupReport = {
  startedAt?: string;
  finishedAt?: string;
  ok?: boolean;
  offsite?: boolean;
  remote?: string;
  step?: string;
  message?: string;
};

export type BackupHealth =
  | { state: "not-applicable" }
  | { state: "ok"; report: BackupReport; ageHours: number }
  | { state: "attention"; reason: string; report: BackupReport | null; ageHours: number | null };

export const STALE_AFTER_HOURS = 36;

export function assessBackup(report: BackupReport | null, now = Date.now()): Exclude<BackupHealth, { state: "not-applicable" }> {
  if (!report) return { state: "attention", reason: "No backup has run on this server yet. Run ./deploy/server-setup.sh once on the server to schedule the nightly backup.", report: null, ageHours: null };
  const finished = report.finishedAt ? Date.parse(report.finishedAt) : NaN;
  const ageHours = Number.isFinite(finished) ? Math.max(0, (now - finished) / 3_600_000) : null;
  if (report.ok !== true) return { state: "attention", reason: report.message || "The last backup failed.", report, ageHours };
  if (report.offsite !== true) return { state: "attention", reason: report.message || "The last backup was kept on the server only.", report, ageHours };
  if (ageHours === null || ageHours > STALE_AFTER_HOURS) {
    return { state: "attention", reason: `The last off-server backup finished ${ageHours === null ? "at an unknown time" : `${Math.round(ageHours)} hours ago`}. The nightly backup may not be running.`, report, ageHours };
  }
  return { state: "ok", report, ageHours };
}

export async function readBackupHealth(): Promise<BackupHealth> {
  const file = process.env.SCRIPTORIUM_BACKUP_STATUS_FILE?.trim();
  if (!file) return { state: "not-applicable" };
  let report: BackupReport | null = null;
  try {
    report = JSON.parse(await readFile(file, "utf8")) as BackupReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("[backup-status] could not read", file, error);
  }
  return assessBackup(report);
}
