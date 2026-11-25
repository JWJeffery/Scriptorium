import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, safeNextPath, secretsMatch, sessionCookieOptions } from "../../../../lib/session";

// A simple brake on password guessing: 8 wrong tries per 15 minutes, across all visitors.
// (In memory, so it resets when the server restarts; fine for a one-person site.)
const failures: number[] = [];
const WINDOW_MS = 15 * 60 * 1000;
const ALLOWED = 8;

export async function POST(request: NextRequest) {
  const user = process.env.DASHBOARD_AUTH_USER;
  const password = process.env.DASHBOARD_AUTH_PASSWORD;
  if (!user || !password) return NextResponse.json({ error: "Sign-in is not configured." }, { status: 503 });

  const now = Date.now();
  while (failures.length && now - failures[0] > WINDOW_MS) failures.shift();
  if (failures.length >= ALLOWED) return NextResponse.json({ error: "Too many failed attempts. Try again later." }, { status: 429 });

  let body: { username?: unknown; password?: unknown; next?: unknown } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 }); }

  const [userOk, passwordOk] = await Promise.all([
    secretsMatch(typeof body.username === "string" ? body.username.slice(0, 200) : "", user),
    secretsMatch(typeof body.password === "string" ? body.password.slice(0, 500) : "", password)
  ]);
  if (!(userOk && passwordOk)) {
    failures.push(now);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return NextResponse.json({ error: "That user name and password do not match." }, { status: 401 });
  }

  const secure = request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";
  const response = NextResponse.json({ ok: true, next: safeNextPath(typeof body.next === "string" ? body.next : "/") });
  response.cookies.set(SESSION_COOKIE, await createSessionToken({ user, password, secret: process.env.DASHBOARD_SESSION_SECRET }), sessionCookieOptions(secure));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
