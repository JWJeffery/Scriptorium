import assert from "node:assert/strict";
import { createSessionToken, checkSessionToken, readCookie, safeNextPath, secretsMatch, SESSION_SECONDS } from "../apps/web/lib/session.ts";
import { hit, blocked, reset, clientKey } from "../apps/web/lib/rate-limit.ts";

const config = { user: "scholar", password: "correct horse battery staple" };
const now = Date.UTC(2026, 9, 2, 12, 0, 0);

// --- sessions
const token = await createSessionToken(config, now);
assert.deepEqual(await checkSessionToken(token, config, now + 1000), { valid: true, shouldRenew: false });
assert.equal((await checkSessionToken(token, config, now + 2 * 86_400_000)).shouldRenew, true, "a session more than a day old is renewed");
assert.equal((await checkSessionToken(token, config, now + (SESSION_SECONDS + 5) * 1000)).valid, false, "expired");
assert.equal((await checkSessionToken(token, { ...config, password: "another password" }, now)).valid, false, "changing the password signs everyone out");
assert.equal((await checkSessionToken(token, { ...config, secret: "explicit" }, now)).valid, false);
assert.equal((await checkSessionToken(await createSessionToken({ ...config, secret: "explicit" }, now), { ...config, secret: "explicit" }, now)).valid, true, "an explicit secret works");
assert.equal((await checkSessionToken(token.slice(0, -3) + "AAA", config, now)).valid, false, "a tampered signature is refused");
const [payload, signature] = token.split(".");
const forgedPayload = btoa(JSON.stringify({ u: "scholar", iat: 1, exp: 99999999999 })).replace(/=+$/, "");
assert.equal((await checkSessionToken(`${forgedPayload}.${signature}`, config, now)).valid, false, "a forged payload is refused");
assert.equal((await checkSessionToken("", config, now)).valid, false);
assert.equal((await checkSessionToken("garbage", config, now)).valid, false);
assert.equal((await checkSessionToken(undefined, config, now)).valid, false);
assert.ok(payload && signature);

// --- helpers
assert.equal(readCookie("a=1; scriptorium_session=abc.def; b=2", "scriptorium_session"), "abc.def");
assert.equal(readCookie(null, "x"), undefined);
assert.equal(safeNextPath("/reading?doc=1"), "/reading?doc=1");
for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "/login", "/api/backup", "", null, undefined]) assert.equal(safeNextPath(bad), "/", `refuses ${bad}`);
assert.equal(await secretsMatch("same", "same"), true);
assert.equal(await secretsMatch("same", "different"), false);

// --- rate limiting
reset("k");
for (let i = 0; i < 3; i += 1) assert.equal(hit("k", 3, 60, 1000 + i).allowed, true);
const fourth = hit("k", 3, 60, 1010);
assert.equal(fourth.allowed, false);
assert.ok(fourth.retryAfterSeconds >= 59 && fourth.retryAfterSeconds <= 60);
assert.equal(hit("other", 3, 60, 1010).allowed, true, "keys are independent");
assert.equal(hit("k", 3, 60, 1000 + 61_000).allowed, true, "the window slides");
reset("b");
assert.equal(blocked("b", 2, 60, 0).allowed, true);
hit("b", 2, 60, 0); hit("b", 2, 60, 1);
assert.equal(blocked("b", 2, 60, 2).allowed, false);
assert.equal(blocked("b", 2, 60, 61_000).allowed, true);
reset("b");
assert.equal(blocked("b", 2, 60, 2).allowed, true, "reset forgives");
assert.equal(clientKey(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
assert.equal(clientKey(new Headers()), "unknown");

console.log("Sessions and rate limiting verified: signed tokens, expiry, tampering, password change, safe redirects, sliding-window limits.");
