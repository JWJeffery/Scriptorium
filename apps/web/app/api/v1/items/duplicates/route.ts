import { NextResponse } from "next/server";
import { route } from "../../../../../lib/api-v1";
import { backfillChecksums, duplicateGroups } from "../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET lists groups of items whose original files are byte-for-byte identical.
export const GET = route(async () => NextResponse.json({ groups: await duplicateGroups() }));

// POST records checksums for books uploaded before they were tracked, then returns the groups.
export const POST = route(async () => {
  const backfill = await backfillChecksums();
  return NextResponse.json({ ...backfill, groups: await duplicateGroups() });
});
