import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { boxAuthorizeUrl, boxConfigured } from "../../../../../lib/box";
import { publicOrigin } from "../../../../../lib/public-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 1 of connecting Box: send the browser to Box's own sign-in page. A random "state" kept in a short-lived
// cookie proves, when Box sends the browser back, that the request started here.
export async function GET(request: NextRequest) {
  if (!boxConfigured()) return NextResponse.json({ error: "Box is not set up on this server (see docs/CLOUD_IMPORT.md)." }, { status: 404 });
  const state = randomBytes(24).toString("hex");
  const origin = publicOrigin(request);
  const response = NextResponse.redirect(boxAuthorizeUrl(`${origin}/api/import/box/callback`, state), 302);
  response.cookies.set("scriptorium_box_state", state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/api/import/box", maxAge: 600 });
  return response;
}
