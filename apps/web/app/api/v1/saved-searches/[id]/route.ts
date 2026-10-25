import { NextResponse } from "next/server";
import { route } from "../../../../../lib/api-v1";
import { deleteSavedSearch } from "../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_request, context) => NextResponse.json(await deleteSavedSearch((await context.params).id)));
