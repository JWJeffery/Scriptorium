// Signed login sessions. Works in the middleware (Edge runtime) and in route
// handlers, so it uses only Web Crypto, no Node-only modules.
//
// A session is "<payload>.<signature>": the payload says who and until when, the
// signature is an HMAC-SHA-256 only the server can make. The signing key comes from
// SCRIPTORIUM_SESSION_SECRET if set; otherwise it is derived from the login name and
// password, so changing the password signs everybody out.

export const SESSION_COOKIE = "scriptorium_session";
export const SESSION_SECONDS = 14 * 24 * 60 * 60;
const RENEW_AFTER_SECONDS = 24 * 60 * 60;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/** Compares two secrets without revealing, by timing, how much of them matched. */
export async function secretsMatch(provided: string, expected: string) {
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function signingKey(user: string, password: string, explicitSecret?: string) {
  const material = explicitSecret?.trim() ? `secret\0${explicitSecret.trim()}` : `login\0${user}\0${password}`;
  return crypto.subtle.importKey("raw", await sha256(`scriptorium-session\0${material}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export type SessionConfig = { user: string; password: string; secret?: string };

export async function createSessionToken(config: SessionConfig, now = Date.now()) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ u: config.user, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + SESSION_SECONDS })));
  const key = await signingKey(config.user, config.password, config.secret);
  const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
  return `${payload}.${signature}`;
}

export type SessionCheck = { valid: boolean; shouldRenew: boolean };

export async function checkSessionToken(token: string | undefined, config: SessionConfig, now = Date.now()): Promise<SessionCheck> {
  const invalid = { valid: false, shouldRenew: false };
  if (!token) return invalid;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return invalid;
  try {
    const key = await signingKey(config.user, config.password, config.secret);
    const ok = await crypto.subtle.verify("HMAC", key, fromBase64Url(signature), encoder.encode(payload));
    if (!ok) return invalid;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { u?: string; iat?: number; exp?: number };
    const seconds = Math.floor(now / 1000);
    if (data.u !== config.user || typeof data.exp !== "number" || data.exp <= seconds) return invalid;
    return { valid: true, shouldRenew: typeof data.iat === "number" && seconds - data.iat > RENEW_AFTER_SECONDS };
  } catch {
    return invalid;
  }
}

export function readCookie(header: string | null, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: SESSION_SECONDS };
}

/** Only follow a "go back to where I was" address if it stays on this site. */
export function safeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.startsWith("/login") || value.startsWith("/api/")) return "/";
  return value;
}
