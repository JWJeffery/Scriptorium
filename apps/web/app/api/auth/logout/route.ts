import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secure = request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
