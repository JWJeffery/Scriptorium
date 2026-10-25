import { NextResponse } from "next/server";
import { parseBody, route } from "../../../../../../lib/api-v1";
import { progressSchema, recordProgress } from "../../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route<{ params: Promise<{ id: string }> }>(async (request, context) => {
  const input = await parseBody(request, progressSchema);
  return NextResponse.json(await recordProgress((await context.params).id, input));
});
