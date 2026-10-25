import { NextResponse } from "next/server";
import { parseBody, route } from "../../../../../lib/api-v1";
import { getItem, softDeleteItem, updateItem, updateItemSchema } from "../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, context) => NextResponse.json(await getItem((await context.params).id)));

// state, favorite, title and tags. Send baseVersion (the "version" you last saw) to be told about conflicts.
export const PATCH = route<Context>(async (request, context) => {
  const patch = await parseBody(request, updateItemSchema);
  return NextResponse.json(await updateItem((await context.params).id, patch));
});

// Soft delete: the item disappears from the library and can be restored.
export const DELETE = route<Context>(async (_request, context) => NextResponse.json(await softDeleteItem((await context.params).id)));
