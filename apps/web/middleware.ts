import { NextRequest, NextResponse } from "next/server";

// Application-level gate. The host (Spaceship/cPanel) may already protect the
// site with HTTP basic auth, but that protects only the URLs the host covers.
// This middleware makes Scriptorium refuse to serve anything unless the
// request carries the credentials configured in SCRIPTORIUM_AUTH_USER and
// SCRIPTORIUM_AUTH_PASSWORD, so a mis-scoped host rule (another subdomain, the
// raw IP, a direct port) cannot expose the corpus.
//
// It also blocks cross-site state-changing requests. Browsers attach cached
// basic-auth credentials to cross-site requests, and the API routes parse
// JSON regardless of Content-Type, so without this a page on another site
// could silently write to the corpus while you are logged in.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Scriptorium", charset="UTF-8"', "Cache-Control": "no-store" }
  });
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

// Compares fixed-length digests so the comparison time does not depend on
// where the first differing character is.
async function secretsMatch(provided: string, expected: string) {
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hasValidCredentials(request: NextRequest, user: string, password: string) {
  const header = request.headers.get("authorization") ?? "";
  if (!/^basic /i.test(header)) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const [userOk, passwordOk] = await Promise.all([
    secretsMatch(decoded.slice(0, separator), user),
    secretsMatch(decoded.slice(separator + 1), password)
  ]);
  return userOk && passwordOk;
}

function isCrossSiteWrite(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false; // Non-browser clients (scripts, curl) send no Origin.
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  return originHost !== requestHost.split(",")[0].trim();
}

export async function middleware(request: NextRequest) {
  const user = process.env.SCRIPTORIUM_AUTH_USER;
  const password = process.env.SCRIPTORIUM_AUTH_PASSWORD;

  if (user && password) {
    if (!(await hasValidCredentials(request, user, password))) return unauthorized();
  } else if (process.env.NODE_ENV === "production" && process.env.SCRIPTORIUM_AUTH_DISABLED !== "true") {
    // Fail closed: a production deployment with no credentials configured
    // must not silently serve an open corpus.
    return new NextResponse(
      "Scriptorium is not configured. Set SCRIPTORIUM_AUTH_USER and SCRIPTORIUM_AUTH_PASSWORD (or SCRIPTORIUM_AUTH_DISABLED=true to opt out).",
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (isCrossSiteWrite(request)) {
    return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
