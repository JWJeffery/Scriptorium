import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authUrl, googleConfigured, publicUrl } from "../../../../lib/google";

export const dynamic = "force-dynamic";

// Sends you to Google's "allow read-only access?" page. The random `state` is also kept in a short-lived
// cookie; the callback only accepts the return trip if the two match (stops someone else's sign-in being injected).
export function GET() {
  if (!googleConfigured()) return NextResponse.json({ error: "Google is not set up on this server yet." }, { status: 503 });
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authUrl(state), 307);
  response.cookies.set("dashboard_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: publicUrl().startsWith("https:"), path: "/api/google", maxAge: 600 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
