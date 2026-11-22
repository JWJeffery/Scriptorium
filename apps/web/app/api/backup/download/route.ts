import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fail, text } from "../../../../lib/api-helpers";
import { BACKUP_NAME_PATTERN, backupPath, backupStream } from "../../../../lib/backup";
import { HEAVY_BUSY_MESSAGE, tryAcquireHeavyLock } from "../../../../lib/heavy-job-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const headers = (name: string, extra: Record<string, string> = {}) => ({
  "content-type": "application/zip",
  "content-disposition": `attachment; filename="${name}"`,
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  ...extra
});

// With ?name=... download a backup saved on the server. Without it, build a
// fresh backup and stream it straight to the browser (nothing kept on the server).
export async function GET(request: NextRequest) {
  const name = text(request.nextUrl.searchParams.get("name"));
  if (name) {
    if (!BACKUP_NAME_PATTERN.test(name)) return fail("Invalid backup name.");
    try {
      const info = await stat(backupPath(name));
      return new Response(Readable.toWeb(createReadStream(backupPath(name))) as ReadableStream, { headers: headers(name, { "content-length": String(info.size) }) });
    } catch {
      return fail("That backup was not found.", 404);
    }
  }

  // One heavy task at a time, server-wide; held until the download stream ends or fails.
  const lock = await tryAcquireHeavyLock("backup-download");
  if (!lock) return fail(HEAVY_BUSY_MESSAGE, 429);
  let stream: ReturnType<typeof backupStream>;
  try {
    stream = backupStream();
  } catch (error) {
    await lock.release();
    throw error;
  }
  const release = () => void lock.release();
  stream.once("close", release);
  stream.once("error", release);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers: headers(`scriptorium-backup-${date}.zip`) });
}
