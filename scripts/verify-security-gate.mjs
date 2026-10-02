// Live check of apps/web/middleware.ts (login page, session cookie, rate limits, CSRF, headers).
// Usage: SCRIPTORIUM_BASE_URL=http://127.0.0.1:3101 SCRIPTORIUM_AUTH_USER=u \
//        SCRIPTORIUM_AUTH_PASSWORD=p node scripts/verify-security-gate.mjs
// Run it against a server started with the same SCRIPTORIUM_AUTH_* values.
import assert from "node:assert/strict";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3101";
const user = process.env.SCRIPTORIUM_AUTH_USER ?? "tester";
const password = process.env.SCRIPTORIUM_AUTH_PASSWORD ?? "correct horse battery";
const basic = (u, p) => ({ authorization: `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}` });
const good = basic(user, password);
const bad = basic(user, "wrong");
const probe = `${baseUrl}/api/milestone-one/workspace`; // answers 400 before touching the DB
const noFollow = { redirect: "manual" };
let ipCounter = 0;
const ip = () => ({ "x-forwarded-for": `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` });
const login = (p, extra = {}) =>
  fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(baseUrl).origin, ...extra },
    body: JSON.stringify({ username: user, password: p, next: "/" }),
  });

// Anonymous visitors: pages redirect to /login, APIs answer 401 JSON (no browser popup).
const page = await fetch(`${baseUrl}/`, { ...noFollow, headers: { accept: "text/html", ...ip() } });
assert.equal(page.status, 307, "anonymous page request redirects");
assert.match(page.headers.get("location") ?? "", /\/login\?next=/);
const api = await fetch(probe, { headers: ip() });
assert.equal(api.status, 401);
assert.equal(api.headers.get("www-authenticate"), null, "no browser Basic popup");
assert.equal((await api.json()).error, "Sign in required.");

// Scripts can still use Basic auth; wrong Basic is refused.
assert.equal((await fetch(probe, { headers: { ...bad, ...ip() } })).status, 401);
const ok = await fetch(probe, { headers: { ...good, ...ip() } });
assert.equal(ok.status, 400, "valid Basic credentials reach the route");
for (const h of ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"]) {
  assert.ok(ok.headers.get(h), `${h} must be set`);
}
assert.equal(ok.headers.get("x-powered-by"), null);

// The login page is public and carries the security headers.
const loginPage = await fetch(`${baseUrl}/login`, { headers: ip() });
assert.equal(loginPage.status, 200);
assert.ok(loginPage.headers.get("content-security-policy"));

// Wrong password -> 401; right password -> HttpOnly SameSite=Lax cookie that grants access.
assert.equal((await login("nope", ip())).status, 401);
const good1 = await login(password, ip());
assert.equal(good1.status, 200);
const setCookie = good1.headers.get("set-cookie") ?? "";
assert.match(setCookie, /scriptorium_session=/);
assert.match(setCookie, /HttpOnly/i);
assert.match(setCookie, /SameSite=Lax/i);
const cookie = setCookie.split(";")[0];
assert.equal((await fetch(probe, { headers: { cookie, ...ip() } })).status, 400, "cookie grants access");
const sess = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie, ...ip() } })).json();
assert.equal(sess.signedIn, true);

// Open redirects are neutralised.
const evil = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: new URL(baseUrl).origin, ...ip() },
  body: JSON.stringify({ username: user, password, next: "https://evil.example/" }),
});
assert.equal((await evil.json()).next, "/");

// Logout clears the cookie.
const out = await fetch(`${baseUrl}/api/auth/logout`, {
  method: "POST",
  headers: { cookie, origin: new URL(baseUrl).origin, ...ip() },
});
assert.match(out.headers.get("set-cookie") ?? "", /scriptorium_session=;|Max-Age=0|expires=/i);

// Lockout: 8 failures from one address -> 429 with Retry-After.
const lockIp = ip();
let last;
for (let i = 0; i < 9; i++) last = await login("bad" + i, lockIp);
assert.equal(last.status, 429);
assert.ok(last.headers.get("retry-after"));

// Heavy-path rate limit.
const heavyIp = ip();
let heavy = 0;
for (let i = 0; i < 30; i++) {
  const r = await fetch(`${baseUrl}/api/threads/export?threadId=x`, { headers: { ...good, ...heavyIp } });
  if (r.status === 429) heavy++;
}
assert.ok(heavy > 0, "heavy endpoints are rate limited");

// Cross-site writes.
const write = (headers) =>
  fetch(`${baseUrl}/api/milestone-seventeen/page-split`, {
    method: "POST",
    headers: { ...good, ...ip(), ...headers },
    body: "{}",
  });
assert.equal((await write({ origin: "https://evil.example" })).status, 403);
assert.equal((await write({ "sec-fetch-site": "cross-site" })).status, 403);
assert.equal((await write({ origin: new URL(baseUrl).origin, "content-type": "application/json" })).status, 400);
assert.equal((await write({})).status, 400);

console.log("Security gate verified: login page, session cookie, Basic fallback, lockout, rate limits, CSRF, headers.");
