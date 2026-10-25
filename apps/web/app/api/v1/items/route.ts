import { NextResponse } from "next/server";
import { parseQuery, route } from "../../../../lib/api-v1";
import { listItems, listQuerySchema } from "../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/items?view=reading&q=&tag=&collectionId=&savedSearchId=&cursor=&limit=
export const GET = route(async (request) => NextResponse.json(await listItems(parseQuery(request, listQuerySchema))));
