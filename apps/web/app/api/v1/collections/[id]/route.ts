import { NextResponse } from "next/server";
import { parseBody, route } from "../../../../../lib/api-v1";
import { collectionPatchSchema, deleteCollection, updateCollection } from "../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const PATCH = route<Context>(async (request, context) => NextResponse.json(await updateCollection((await context.params).id, await parseBody(request, collectionPatchSchema))));

// Removes the grouping only; the items stay in the library.
export const DELETE = route<Context>(async (_request, context) => NextResponse.json(await deleteCollection((await context.params).id)));
