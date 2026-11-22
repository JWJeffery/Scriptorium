import { lookup } from "node:dns/promises";
import net from "node:net";
import { looksLikePdf } from "./upload-guards.ts";

// Fetch a PDF from a link someone pasted (a Google Drive, Dropbox or Box share link, or any direct link to a PDF).
// A server that fetches addresses on request can be pointed at its own private network, so every address, including
// every redirect, must resolve to the public internet; size, time and type are capped.
// SCRIPTORIUM_IMPORT_ALLOW_PRIVATE=true lifts the address rule for automated tests only. Never set it on a server.

export class RemoteFetchError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

type Provider = "google-drive" | "dropbox" | "box" | "web";

function ipv4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return !ipv4Private(ip);
  if (!net.isIPv6(ip)) return false;
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return !ipv4Private(mapped[1]);
  return !(lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("ff") || lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8"));
}

async function assertPublicHost(hostname: string) {
  if (process.env.SCRIPTORIUM_IMPORT_ALLOW_PRIVATE === "true") return;
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw new RemoteFetchError(`The address ${hostname} could not be found.`); })).map((entry) => entry.address);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new RemoteFetchError("That link points to a private network address, which Scriptorium will not fetch.");
}

/** Turn a share link into a direct-download link, and say which service it is. */
export function toDownloadUrl(input: string): { url: URL; provider: Provider } {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new RemoteFetchError("That is not a web address. Paste the whole link, starting with https://"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new RemoteFetchError("Only http and https links can be added.");
  const host = url.hostname.toLowerCase();

  if (host === "docs.google.com") throw new RemoteFetchError("That is a Google Docs/Sheets/Slides link, not a PDF. In Google, use File > Download > PDF, put that PDF in Drive, and share its link.");
  if (host === "drive.google.com" || host === "drive.usercontent.google.com") {
    const id = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? url.searchParams.get("id");
    if (!id) throw new RemoteFetchError("That Google Drive link does not point to a single file. Open the PDF in Drive, choose Share > Copy link, and paste that.");
    return { url: new URL(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`), provider: "google-drive" };
  }
  if (host === "dropbox.com" || host === "www.dropbox.com") {
    url.searchParams.set("dl", "1");
    return { url, provider: "dropbox" };
  }
  if (host === "app.box.com" || host.endsWith(".app.box.com") || host === "box.com" || host.endsWith(".box.com")) {
    const shared = url.pathname.match(/^\/s\/([A-Za-z0-9]+)/)?.[1];
    if (shared) return { url: new URL(`https://${host === "box.com" ? "app.box.com" : host}/shared/static/${shared}`), provider: "box" };
    return { url, provider: "box" };
  }
  return { url, provider: "web" };
}

function filenameFrom(response: Response, url: URL) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const star = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let name = "";
  try { name = star ? decodeURIComponent(star.trim().replace(/^"|"$/g, "")) : plain ?? ""; } catch { name = plain ?? ""; }
  if (!name) name = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "") || "book.pdf";
  name = name.replace(/[\\/\u0000-\u001f]+/g, " ").trim().slice(0, 200) || "book.pdf";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function notAPdfMessage(provider: Provider, looksLikePage: boolean) {
  if (!looksLikePage) return "That link did not lead to a PDF file.";
  if (provider === "google-drive") return "Google Drive answered with a web page instead of the file. Make sure the PDF is shared as \"Anyone with the link\" (Share > General access), or use From Google Drive instead.";
  if (provider === "box") return "Box answered with a web page instead of the file. Box only allows direct downloads for some accounts; use From Box instead.";
  if (provider === "dropbox") return "Dropbox answered with a web page instead of the file. Make sure the link is shared with \"Anyone with the link\".";
  return "That link leads to a web page, not a PDF. Open it in your browser, find the PDF's own download link, and paste that.";
}

export async function fetchRemotePdf(input: string, maxBytes: number, timeoutMs = 120_000): Promise<{ bytes: Buffer; filename: string; provider: Provider }> {
  const { url: start, provider } = toDownloadUrl(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = start;
    for (let hop = 0; hop <= 5; hop += 1) {
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new RemoteFetchError("The link redirected somewhere Scriptorium will not follow.");
      if (url.port && url.port !== "80" && url.port !== "443" && process.env.SCRIPTORIUM_IMPORT_ALLOW_PRIVATE !== "true") throw new RemoteFetchError("Links to unusual ports are not fetched.");
      await assertPublicHost(url.hostname);
      let response: Response;
      try {
        response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "Scriptorium/1 (personal library import)", accept: "application/pdf,*/*;q=0.5" } });
      } catch (error) {
        if (controller.signal.aborted) throw new RemoteFetchError("The download took too long and was stopped.", 504);
        throw new RemoteFetchError(`The link could not be reached (${error instanceof Error ? error.message : "network error"}).`, 502);
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        url = new URL(response.headers.get("location") as string, url);
        await response.body?.cancel();
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new RemoteFetchError(provider === "web" ? "That link needs a sign-in, so Scriptorium cannot fetch it." : "That file is not shared publicly. Share it as \"Anyone with the link\", or sign in with From Google Drive / From Box.", 403);
      if (response.status === 404) throw new RemoteFetchError("Nothing was found at that link.", 404);
      if (!response.ok || !response.body) throw new RemoteFetchError(`The link answered with an error (${response.status}).`, 502);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > maxBytes) throw new RemoteFetchError(`That PDF is ${Math.round(declared / 1024 / 1024)} MB; the largest that can be added is ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > maxBytes) { controller.abort(); throw new RemoteFetchError(`That PDF is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, the largest that can be added.`, 413); }
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (!looksLikePdf(bytes)) {
        const head = bytes.subarray(0, 512).toString("latin1").trimStart().toLowerCase();
        throw new RemoteFetchError(notAPdfMessage(provider, head.startsWith("<")), 415);
      }
      return { bytes, filename: filenameFrom(response, url), provider };
    }
    throw new RemoteFetchError("The link redirected too many times.");
  } finally {
    clearTimeout(timer);
  }
}
