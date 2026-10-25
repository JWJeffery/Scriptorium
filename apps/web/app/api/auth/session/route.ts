import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkSessionToken, readCookie } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tells the page whether this server asks people to sign in, and whether this visitor has.
export async function GET(request: NextRequest) {
  const user = process.env.SCRIPTORIUM_AUTH_USER;
  const password = process.env.SCRIPTORIUM_AUTH_PASSWORD;
  if (!user || !password) return NextResponse.json({ authRequired: false, signedIn: true });
  const session = await checkSessionToken(readCookie(request.headers.get("cookie"), SESSION_COOKIE), { user, password, secret: process.env.SCRIPTORIUM_SESSION_SECRET });
  return NextResponse.json({ authRequired: true, signedIn: session.valid }, { headers: { "Cache-Control": "no-store" } });
}
