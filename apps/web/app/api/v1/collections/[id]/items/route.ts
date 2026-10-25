import { NextResponse } from "next/server";
import { parseBody, route } from "../../../../../../lib/api-v1";
import { addToCollection, membershipSchema, removeFromCollection } from "../../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (request, context) => NextResponse.json(await addToCollection((await context.params).id, (await parseBody(request, membershipSchema)).itemIds)));

export const DELETE = route<Context>(async (request, context) => NextResponse.json(await removeFromCollection((await context.params).id, (await parseBody(request, membershipSchema)).itemIds)));
