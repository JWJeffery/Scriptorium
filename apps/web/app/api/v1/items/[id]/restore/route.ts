import { NextResponse } from "next/server";
import { route } from "../../../../../../lib/api-v1";
import { restoreItem } from "../../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route<{ params: Promise<{ id: string }> }>(async (_request, context) => NextResponse.json(await restoreItem((await context.params).id)));
