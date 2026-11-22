import { NextResponse } from "next/server";
import { parseBody, route } from "../../../../../../lib/api-v1";
import { progressSchema, readProgress, recordProgress } from "../../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route<{ params: Promise<{ id: string }> }>(async (request, context) => {
  const input = await parseBody(request, progressSchema);
  return NextResponse.json(await recordProgress((await context.params).id, input));
});

// Where the book was last left (on any device) and when, so another device can pick up there.
export const GET = route<{ params: Promise<{ id: string }> }>(async (_request, context) => {
  return NextResponse.json(await readProgress((await context.params).id), { headers: { "cache-control": "no-store" } });
});
