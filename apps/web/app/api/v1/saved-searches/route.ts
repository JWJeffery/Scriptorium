import { NextResponse } from "next/server";
import { parseBody, route } from "../../../../lib/api-v1";
import { createSavedSearch, listSavedSearches, savedSearchSchema } from "../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json({ savedSearches: await listSavedSearches() }));

export const POST = route(async (request) => NextResponse.json(await createSavedSearch(await parseBody(request, savedSearchSchema)), { status: 201 }));
