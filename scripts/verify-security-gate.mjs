// Live check of apps/web/middleware.ts and the security headers.
// Usage: SCRIPTORIUM_BASE_URL=http://127.0.0.1:3101 SCRIPTORIUM_AUTH_USER=u \
//        SCRIPTORIUM_AUTH_PASSWORD=p node scripts/verify-security-gate.mjs
// Run it against a server started with the same SCRIPTORIUM_AUTH_* values.
import assert from "node:assert/strict";

const baseUrl = process.env.SCRIPTORIUM_BASE_URL ?? "http://127.0.0.1:3101";
const user = process.env.SCRIPTORIUM_AUTH_USER ?? "tester";
const password = process.env.SCRIPTORIUM_AUTH_PASSWORD ?? "correct horse battery";
const good = { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
const bad = { authorization: `Basic ${Buffer.from(`${user}:wrong`).toString("base64")}` };
// A route that answers 400 before touching the database, so no MySQL is needed.
const probe = `${baseUrl}/api/milestone-one/workspace`;

const anonymous = await fetch(probe);
assert.equal(anonymous.status, 401, "request without credentials must be refused");
assert.match(anonymous.headers.get("www-authenticate") ?? "", /^Basic /i);

assert.equal((await fetch(probe, { headers: bad })).status, 401, "wrong password must be refused");
assert.equal((await fetch(`${baseUrl}/`)).status, 401, "the page itself must be gated");

const ok = await fetch(probe, { headers: good });
assert.equal(ok.status, 400, "valid credentials reach the route");

for (const header of ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"]) {
  assert.ok(ok.headers.get(header), `${header} must be set`);
}
assert.equal(ok.headers.get("x-powered-by"), null, "x-powered-by must be removed");

const write = (headers) =>
  fetch(`${baseUrl}/api/milestone-seventeen/page-split`, { method: "POST", headers: { ...good, ...headers }, body: "{}" });

assert.equal((await write({ origin: "https://evil.example" })).status, 403, "cross-origin write must be refused");
assert.equal((await write({ "sec-fetch-site": "cross-site" })).status, 403, "cross-site write must be refused");
const sameOrigin = await write({ origin: new URL(baseUrl).origin, "content-type": "application/json" });
assert.equal(sameOrigin.status, 400, "same-origin write passes the gate (route then asks for versionId)");
assert.equal((await write({})).status, 400, "origin-less (non-browser) write passes the gate");

console.log("Security gate verified: basic auth, cross-site write blocking, and response headers.");
