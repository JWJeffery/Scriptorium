import { NextRequest, NextResponse } from "next/server";
import { fail, readJsonObject, text } from "../../../../lib/api-helpers";
import { blocked, clientKey, hit, reset } from "../../../../lib/rate-limit";
import { SESSION_COOKIE, createSessionToken, safeNextPath, secretsMatch, sessionCookieOptions } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURES_ALLOWED = 8;
const WINDOW_SECONDS = 15 * 60;
const GLOBAL_FAILURES_ALLOWED = 60;

export async function POST(request: NextRequest) {
  const user = process.env.SCRIPTORIUM_AUTH_USER;
  const password = process.env.SCRIPTORIUM_AUTH_PASSWORD;
  if (!user || !password) return NextResponse.json({ ok: true, next: "/", note: "Sign-in is not enabled on this server." });

  const visitor = `login:${clientKey(request.headers)}`;
  const lockedOut = blocked(visitor, FAILURES_ALLOWED, WINDOW_SECONDS);
  const globallyBlocked = blocked("login:*", GLOBAL_FAILURES_ALLOWED, WINDOW_SECONDS);
  if (!lockedOut.allowed || !globallyBlocked.allowed) {
    const wait = Math.max(lockedOut.retryAfterSeconds, globallyBlocked.retryAfterSeconds);
    return NextResponse.json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 90 ? "s" : ""}.` }, { status: 429, headers: { "Retry-After": String(wait) } });
  }

  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  // Both are always compared, so the response time does not reveal which one was wrong.
  const [userOk, passwordOk] = await Promise.all([secretsMatch(text(body.username, 200), user), secretsMatch(typeof body.password === "string" ? body.password.slice(0, 500) : "", password)]);
  if (!(userOk && passwordOk)) {
    hit(visitor, FAILURES_ALLOWED, WINDOW_SECONDS);
    hit("login:*", GLOBAL_FAILURES_ALLOWED, WINDOW_SECONDS);
    await new Promise((resolve) => setTimeout(resolve, 400)); // slows guessing
    return NextResponse.json({ error: "That user name and password do not match." }, { status: 401 });
  }

  reset(visitor);
  const secure = request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";
  const response = NextResponse.json({ ok: true, next: safeNextPath(typeof body.next === "string" ? body.next : "/") });
  response.cookies.set(SESSION_COOKIE, await createSessionToken({ user, password, secret: process.env.SCRIPTORIUM_SESSION_SECRET }), sessionCookieOptions(secure));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
