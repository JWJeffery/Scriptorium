import { prisma } from "./prisma.ts";

// Adding books from Box: the owner signs in to Box once (OAuth 2.0); the server keeps the tokens and downloads the
// chosen PDF. Needs a free Box developer app: SCRIPTORIUM_BOX_CLIENT_ID and SCRIPTORIUM_BOX_CLIENT_SECRET (see
// docs/CLOUD_IMPORT.md). The two base addresses can be overridden only so tests can stand in for Box.
const AUTH_BASE = () => process.env.SCRIPTORIUM_BOX_AUTH_BASE ?? "https://account.box.com";
const API_BASE = () => process.env.SCRIPTORIUM_BOX_API_BASE ?? "https://api.box.com";

export const boxConfigured = () => Boolean(process.env.SCRIPTORIUM_BOX_CLIENT_ID?.trim() && process.env.SCRIPTORIUM_BOX_CLIENT_SECRET?.trim());

export class BoxError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function boxAuthorizeUrl(redirectUri: string, state: string) {
  const url = new URL("/api/oauth2/authorize", AUTH_BASE());
  url.searchParams.set("client_id", process.env.SCRIPTORIUM_BOX_CLIENT_ID ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenReply = { access_token: string; refresh_token: string; expires_in: number };

async function tokenRequest(fields: Record<string, string>) {
  const response = await fetch(new URL("/oauth2/token", API_BASE()), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.SCRIPTORIUM_BOX_CLIENT_ID ?? "", client_secret: process.env.SCRIPTORIUM_BOX_CLIENT_SECRET ?? "", ...fields })
  });
  if (!response.ok) {
    console.error("[box] token request failed:", response.status, await response.text().catch(() => ""));
    throw new BoxError("Box did not accept the sign-in. Try connecting again.", 401);
  }
  return (await response.json()) as TokenReply;
}

async function saveTokens(reply: TokenReply, account?: string | null) {
  const data = { accessToken: reply.access_token, refreshToken: reply.refresh_token, expiresAt: new Date(Date.now() + reply.expires_in * 1000), ...(account !== undefined ? { account } : {}) };
  await prisma.importConnection.upsert({ where: { provider: "box" }, create: { provider: "box", ...data }, update: data });
}

export async function connectBox(code: string, redirectUri: string) {
  const reply = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  await saveTokens(reply, null);
  const me = await boxFetch("/2.0/users/me?fields=login").then((r) => r.json() as Promise<{ login?: string }>).catch(() => ({ login: undefined }));
  if (me.login) await prisma.importConnection.update({ where: { provider: "box" }, data: { account: me.login } });
}

export async function boxConnection() {
  return prisma.importConnection.findUnique({ where: { provider: "box" }, select: { account: true, updatedAt: true } });
}

export async function disconnectBox() {
  await prisma.importConnection.deleteMany({ where: { provider: "box" } });
}

async function accessToken() {
  const row = await prisma.importConnection.findUnique({ where: { provider: "box" } });
  if (!row) throw new BoxError("Box is not connected yet.", 401);
  if (row.expiresAt.getTime() - Date.now() > 60_000) return row.accessToken;
  // Box replaces the refresh token every time it is used, so the new one must be kept.
  const reply = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refreshToken }).catch(async (error) => {
    await disconnectBox();
    throw error instanceof BoxError ? new BoxError("The Box sign-in has expired. Connect Box again.", 401) : error;
  });
  await saveTokens(reply);
  return reply.access_token;
}

async function boxFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, API_BASE()), { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await accessToken()}` } });
  if (response.status === 401) throw new BoxError("The Box sign-in has expired. Connect Box again.", 401);
  if (response.status === 404) throw new BoxError("That item is no longer in Box.", 404);
  if (!response.ok) throw new BoxError(`Box answered with an error (${response.status}).`, 502);
  return response;
}

export type BoxItem = { id: string; type: "folder" | "file"; name: string; size: number | null };

export async function listBoxFolder(folderId: string) {
  if (!/^\d+$/.test(folderId)) throw new BoxError("Invalid folder.");
  const folder = (await (await boxFetch(`/2.0/folders/${folderId}?fields=id,name,path_collection`)).json()) as { id: string; name: string; path_collection?: { entries?: Array<{ id: string; name: string }> } };
  const items: BoxItem[] = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const page = (await (await boxFetch(`/2.0/folders/${folderId}/items?fields=id,type,name,size&limit=1000&offset=${offset}`)).json()) as { entries: Array<{ id: string; type: string; name: string; size?: number }>; total_count: number };
    for (const entry of page.entries) {
      if (entry.type === "folder") items.push({ id: entry.id, type: "folder", name: entry.name, size: null });
      else if (entry.type === "file" && /\.pdf$/i.test(entry.name)) items.push({ id: entry.id, type: "file", name: entry.name, size: entry.size ?? null });
    }
    if (offset + 1000 >= page.total_count) break;
  }
  items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
  const trail = folder.path_collection?.entries ?? [];
  return { folder: { id: folder.id, name: folderId === "0" ? "All files" : folder.name, parentId: trail.length ? trail[trail.length - 1].id : null }, items };
}

export async function downloadBoxFile(fileId: string, maxBytes: number) {
  if (!/^\d+$/.test(fileId)) throw new BoxError("Invalid file.");
  const info = (await (await boxFetch(`/2.0/files/${fileId}?fields=name,size`)).json()) as { name: string; size: number };
  if (info.size > maxBytes) throw new BoxError(`That PDF is ${Math.round(info.size / 1024 / 1024)} MB; the largest that can be added is ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
  // Box answers with a redirect to its download server; fetch follows it (the token is not sent there).
  const response = await boxFetch(`/2.0/files/${fileId}/content`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new BoxError("That PDF is too large to add.", 413);
  return { bytes, filename: /\.pdf$/i.test(info.name) ? info.name : `${info.name}.pdf` };
}
