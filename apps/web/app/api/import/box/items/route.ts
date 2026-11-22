import { NextRequest, NextResponse } from "next/server";
import { BoxError, boxConfigured, listBoxFolder } from "../../../../../lib/box";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The folders and PDFs in one Box folder ("0" is the top), for the Add a book > From Box browser.
export async function GET(request: NextRequest) {
  if (!boxConfigured()) return NextResponse.json({ error: "Box is not set up on this server." }, { status: 404 });
  try {
    return NextResponse.json(await listBoxFolder(request.nextUrl.searchParams.get("folder") ?? "0"), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof BoxError) return NextResponse.json({ error: error.message, connected: error.status !== 401 }, { status: error.status });
    console.error("[box] listing a folder failed:", error);
    return NextResponse.json({ error: "Box could not be reached." }, { status: 502 });
  }
}
