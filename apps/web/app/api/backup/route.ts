import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import { fail, text } from "../../../lib/api-helpers";
import { BACKUP_NAME_PATTERN, backupPath, listBackups, saveBackupOnServer } from "../../../lib/backup";
import { releaseHeavyJob, tryAcquireHeavyJob } from "../../../lib/heavy-job-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// List the backups saved on the server.
export async function GET() {
  return NextResponse.json(await listBackups());
}

// Create a backup and keep it on the server (newest 14 are kept).
export async function POST() {
  const slot = tryAcquireHeavyJob("backup", "all");
  if (!slot.acquired) return fail("Another long job (OCR, page split or backup) is running. Try again when it has finished.", 429);
  try {
    const { name, size, manifest } = await saveBackupOnServer();
    return NextResponse.json({ name, size, totals: manifest.totals }, { status: 201 });
  } catch (error) {
    console.error("Backup failed:", error);
    return fail("The backup could not be created.", 500);
  } finally {
    releaseHeavyJob("backup", "all");
  }
}

export async function DELETE(request: NextRequest) {
  const name = text(request.nextUrl.searchParams.get("name"));
  if (!BACKUP_NAME_PATTERN.test(name)) return fail("Invalid backup name.");
  try { await unlink(backupPath(name)); } catch { return fail("That backup was not found.", 404); }
  return NextResponse.json({ deleted: true, name });
}
