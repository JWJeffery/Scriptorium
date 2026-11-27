import { OAuth2Client } from "google-auth-library";
import { deleteSecret, readSecret, writeSecret } from "./secret-store";

// One Google sign-in serves every Google widget (Calendar now, Gmail later). The dashboard only ever
// asks for READ-ONLY access, and keeps just the long-lived "refresh token", encrypted on disk.

export const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
const STORE = "google";

type Stored = { refreshToken: string; scopes: string[]; connectedAt: string };

export const publicUrl = () => (process.env.DASHBOARD_PUBLIC_URL || "").replace(/\/+$/, "");
export const redirectUri = () => `${publicUrl()}/api/google/callback`;

export function googleConfigured() {
  return Boolean(process.env.DASHBOARD_GOOGLE_CLIENT_ID && process.env.DASHBOARD_GOOGLE_CLIENT_SECRET && publicUrl());
}

function client() {
  return new OAuth2Client(process.env.DASHBOARD_GOOGLE_CLIENT_ID, process.env.DASHBOARD_GOOGLE_CLIENT_SECRET, redirectUri());
}

export function authUrl(state: string) {
  return client().generateAuthUrl({
    access_type: "offline", // gives the long-lived refresh token
    prompt: "consent", // makes Google send it again even if you connected before
    include_granted_scopes: true, // so adding Gmail later keeps Calendar working
    scope: SCOPES,
    state
  });
}

export async function connectWithCode(code: string) {
  const { tokens } = await client().getToken(code);
  if (!tokens.refresh_token) throw new Error("Google did not return a long-lived sign-in.");
  const stored: Stored = { refreshToken: tokens.refresh_token, scopes: (tokens.scope ?? "").split(" ").filter(Boolean), connectedAt: new Date().toISOString() };
  await writeSecret(STORE, stored);
}

export async function isConnected() {
  return (await readSecret<Stored>(STORE)) !== null;
}

export class GoogleReconnectNeeded extends Error {}

/** A short-lived access token, or throws GoogleReconnectNeeded if Google no longer honours the stored sign-in. */
export async function accessToken(): Promise<string> {
  const stored = await readSecret<Stored>(STORE);
  if (!stored) throw new GoogleReconnectNeeded("Not connected.");
  const oauth = client();
  oauth.setCredentials({ refresh_token: stored.refreshToken });
  try {
    const { token } = await oauth.getAccessToken();
    if (!token) throw new Error("no token");
    return token;
  } catch (error) {
    const text = JSON.stringify((error as { response?: { data?: unknown } }).response?.data ?? "") + String((error as Error).message);
    if (/invalid_grant|revoked|expired/i.test(text)) throw new GoogleReconnectNeeded("Google no longer accepts the saved sign-in.");
    throw error;
  }
}

export async function disconnect() {
  const stored = await readSecret<Stored>(STORE);
  if (stored) {
    try { await client().revokeToken(stored.refreshToken); } catch { /* already revoked is fine */ }
  }
  await deleteSecret(STORE);
}
