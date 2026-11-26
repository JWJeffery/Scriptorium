import { NextRequest, NextResponse } from "next/server";
import { connectWithCode, googleConfigured, publicUrl } from "../../../../lib/google";
import { readCookie } from "../../../../lib/session";

export const dynamic = "force-dynamic";

function back(outcome: "connected" | "denied" | "failed") {
  const response = NextResponse.redirect(`${publicUrl()}/?google=${outcome}`, 303);
  response.cookies.set("dashboard_oauth_state", "", { path: "/api/google", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  if (!googleConfigured()) return NextResponse.json({ error: "Google is not set up on this server yet." }, { status: 503 });
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("denied");
  const state = params.get("state");
  const expected = readCookie(request.headers.get("cookie"), "dashboard_oauth_state");
  const code = params.get("code");
  if (!code || !state || !expected || state !== expected) return back("failed");
  try {
    await connectWithCode(code);
    return back("connected");
  } catch {
    return back("failed");
  }
}
