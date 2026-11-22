// This site's public address as the visitor sees it (behind Caddy: X-Forwarded-Proto/Host).
export function publicOrigin(request: Request) {
  const configured = process.env.SCRIPTORIUM_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const headers = request.headers;
  const host = headers.get("x-forwarded-host")?.split(",")[0].trim() || headers.get("host") || new URL(request.url).host;
  const proto = headers.get("x-forwarded-proto")?.split(",")[0].trim() || new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}
