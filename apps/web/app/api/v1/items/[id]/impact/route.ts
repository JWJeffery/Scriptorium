import { NextResponse } from "next/server";
import { route } from "../../../../../../lib/api-v1";
import { deleteImpact } from "../../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What would be affected by deleting this item (shown before the user confirms).
export const GET = route<{ params: Promise<{ id: string }> }>(async (_request, context) => NextResponse.json(await deleteImpact((await context.params).id)));
