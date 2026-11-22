import { NextResponse } from "next/server";
import { readBackupHealth } from "../../../../lib/backup-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The state of the off-server backups, for the warning banner (signed-in only, like every /api route).
export async function GET() {
  return NextResponse.json(await readBackupHealth(), { headers: { "cache-control": "no-store" } });
}
