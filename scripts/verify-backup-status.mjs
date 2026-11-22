// Unit check of the backup warning rules (apps/web/lib/backup-status.ts):
//   node --experimental-strip-types scripts/verify-backup-status.mjs
import assert from "node:assert/strict";
import { assessBackup, STALE_AFTER_HOURS } from "../apps/web/lib/backup-status.ts";

const now = Date.parse("2026-11-22T12:00:00Z");
const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString();

assert.equal(assessBackup(null, now).state, "attention", "no backup ever run needs attention");
assert.match(assessBackup(null, now).reason, /server-setup/, "and says how to schedule it");
assert.equal(assessBackup({ ok: true, offsite: true, finishedAt: hoursAgo(5) }, now).state, "ok", "a fresh off-server backup is fine");
assert.equal(assessBackup({ ok: true, offsite: true, finishedAt: hoursAgo(STALE_AFTER_HOURS + 1) }, now).state, "attention", "a stale one is not");
assert.equal(assessBackup({ ok: false, offsite: false, finishedAt: hoursAgo(1), message: "stopped at: x" }, now).reason, "stopped at: x", "a failure shows the script's own message");
const localOnly = assessBackup({ ok: true, offsite: false, finishedAt: hoursAgo(1), message: "Google Drive is not connected" }, now);
assert.equal(localOnly.state, "attention", "a server-only backup needs attention");
assert.match(localOnly.reason, /Google Drive/);
assert.equal(assessBackup({ ok: true, offsite: true }, now).state, "attention", "an unknown finish time needs attention");
console.log("Backup warning rules verified: fresh, stale, failed, server-only and never-run backups.");
