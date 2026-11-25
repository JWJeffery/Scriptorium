import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkSessionToken, createSessionToken, readCookie, sessionCookieOptions } from "./lib/session";

// The sign-in gate. The dashboard will hold email, calendar and task data, so it serves
// nothing without a valid session. Same design as Scriptorium's gate (signed cookie,
// cross-site writes refused), and like Scriptorium it fails closed in production when
// no credentials are configured.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/health"]);

function isCrossSiteWrite(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
    return new URL(origin).host !== requestHost.split(",")[0].trim();
  } catch {
    return true;
  }
}

const isSecure = (request: NextRequest) => request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isCrossSiteWrite(request)) return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });

  const user = process.env.DASHBOARD_AUTH_USER;
  const password = process.env.DASHBOARD_AUTH_PASSWORD;
  if (!user || !password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("The dashboard is not configured. Set DASHBOARD_AUTH_USER and DASHBOARD_AUTH_PASSWORD.", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.next(); // local development only
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const config = { user, password, secret: process.env.DASHBOARD_SESSION_SECRET };
  const session = await checkSessionToken(readCookie(request.headers.get("cookie"), SESSION_COOKIE), config);
  if (session.valid) {
    const response = NextResponse.next();
    if (session.shouldRenew) response.cookies.set(SESSION_COOKIE, await createSessionToken(config), sessionCookieOptions(isSecure(request)));
    return response;
  }

  if (request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html")) {
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

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
