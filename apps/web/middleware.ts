import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkSessionToken, createSessionToken, readCookie, secretsMatch, sessionCookieOptions } from "./lib/session";
import { clientKey, hit } from "./lib/rate-limit";

// Application-level gate. The host (Spaceship/cPanel) may already protect the site
// with a password, but that covers only the addresses the host rule covers. This
// makes Scriptorium refuse to serve anything unless the visitor has signed in with
// SCRIPTORIUM_AUTH_USER / SCRIPTORIUM_AUTH_PASSWORD, so a mis-scoped host rule
// (another subdomain, the raw IP, a direct port) cannot expose the corpus.
//
// Three ways in:
//   * a signed session cookie, from the /login page (people)
//   * HTTP basic auth with the same credentials (scripts such as a nightly backup)
//   * nothing, only when auth is switched off for development
//
// It also blocks cross-site state-changing requests (a page on another site must not
// be able to write to the corpus while you are signed in) and brakes runaway
// request rates.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/auth/session"]);
// Long-running or heavy endpoints get a much lower allowance.
const HEAVY_PREFIXES = ["/api/backup", "/api/embeddings", "/api/milestone-sixteen/ocr-status", "/api/milestone-seventeen/page-split", "/api/threads/export", "/api/documents/export"];

const GENERAL_PER_MINUTE = 900;
const WRITES_PER_MINUTE = 240;
const HEAVY_PER_MINUTE = 20;

function tooManyRequests(retryAfterSeconds: number, wantsHtml: boolean) {
  return new NextResponse(wantsHtml ? "Too many requests. Please wait a moment and try again." : JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }), {
    status: 429,
    headers: { "Retry-After": String(retryAfterSeconds), "Content-Type": wantsHtml ? "text/plain; charset=utf-8" : "application/json", "Cache-Control": "no-store" }
  });
}

function isCrossSiteWrite(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false; // Non-browser clients (scripts, curl) send no Origin.
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { return true; }
  const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  return originHost !== requestHost.split(",")[0].trim();
}

async function hasValidBasic(request: NextRequest, user: string, password: string) {
  const header = request.headers.get("authorization") ?? "";
  if (!/^basic /i.test(header)) return false;
  let decoded: string;
  try { decoded = atob(header.slice(6).trim()); } catch { return false; }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const [userOk, passwordOk] = await Promise.all([secretsMatch(decoded.slice(0, separator), user), secretsMatch(decoded.slice(separator + 1), password)]);
  return userOk && passwordOk;
}

const isSecure = (request: NextRequest) => request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const wantsHtml = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  const visitor = clientKey(request.headers);

  // 1. Brakes
  const general = hit(`all:${visitor}`, GENERAL_PER_MINUTE, 60);
  if (!general.allowed) return tooManyRequests(general.retryAfterSeconds, wantsHtml);
  if (!SAFE_METHODS.has(request.method)) {
    const writes = hit(`write:${visitor}`, WRITES_PER_MINUTE, 60);
    if (!writes.allowed) return tooManyRequests(writes.retryAfterSeconds, wantsHtml);
  }
  if (HEAVY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const heavy = hit(`heavy:${visitor}`, HEAVY_PER_MINUTE, 60);
    if (!heavy.allowed) return tooManyRequests(heavy.retryAfterSeconds, wantsHtml);
  }

  // 2. Cross-site writes
  if (isCrossSiteWrite(request)) return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });

  // 3. Who is allowed in
  const user = process.env.SCRIPTORIUM_AUTH_USER;
  const password = process.env.SCRIPTORIUM_AUTH_PASSWORD;
  if (!user || !password) {
    if (process.env.NODE_ENV === "production" && process.env.SCRIPTORIUM_AUTH_DISABLED !== "true") {
      // Fail closed: a production deployment with no credentials configured must not serve an open corpus.
      return new NextResponse("Scriptorium is not configured. Set SCRIPTORIUM_AUTH_USER and SCRIPTORIUM_AUTH_PASSWORD (or SCRIPTORIUM_AUTH_DISABLED=true to opt out).", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const config = { user, password, secret: process.env.SCRIPTORIUM_SESSION_SECRET };
  const session = await checkSessionToken(readCookie(request.headers.get("cookie"), SESSION_COOKIE), config);
  if (session.valid) {
    const response = NextResponse.next();
    if (session.shouldRenew) response.cookies.set(SESSION_COOKIE, await createSessionToken(config), sessionCookieOptions(isSecure(request)));
    return response;
  }
  // Scripts may use basic auth. (A browser may also send basic-auth credentials meant for
  // the hosting company's own password prompt; those simply do not match and are ignored.)
  if (await hasValidBasic(request, user, password)) return NextResponse.next();

  if (wantsHtml) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? request.nextUrl.protocol.replace(":", "");
    const target = host ? new URL("/login", `${proto}://${host}`) : new URL("/login", request.url);
    target.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(target, 307);
    redirect.headers.set("Cache-Control", "no-store");
    return redirect;
  }
  return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
