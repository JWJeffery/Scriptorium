import { NextResponse } from "next/server";
import { parseBody, route } from "../../../../lib/api-v1";
import { collectionSchema, createCollection, listCollections } from "../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json({ collections: await listCollections() }));

export const POST = route(async (request) => NextResponse.json(await createCollection(await parseBody(request, collectionSchema)), { status: 201 }));
