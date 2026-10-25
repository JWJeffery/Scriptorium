import { NextResponse } from "next/server";
import { parseQuery, route, z } from "../../../../../lib/api-v1";
import { findItemByChecksum } from "../../../../../lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Is a file with this SHA-256 already in the library? Used before an upload so the reader can be asked first.
export const GET = route(async (request) => {
  const { sha256 } = parseQuery(request, z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/i) }));
  return NextResponse.json({ item: await findItemByChecksum(sha256.toLowerCase()) });
});
