import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { openStoredFileRange, storedFileSize } from "../../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { documentId } = await context.params;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, storageKey: true }
  });

  if (!document?.storageKey) {
    return NextResponse.json({ error: "Stored PDF was not found." }, { status: 404 });
  }

  const size = await storedFileSize(document.storageKey);
  if (size === null) {
    console.error(`The stored PDF for document ${documentId} is missing at ${document.storageKey}.`);
    return NextResponse.json({ error: "The PDF record exists, but its stored file could not be found." }, { status: 404 });
  }

  // A stored file never changes under the same key and size, so this fingerprint lets a browser that already has
  // it skip the download ("not modified"), and the PDF reader can ask for just the parts it needs (byte ranges).
  const etag = `"${createHash("sha1").update(`${document.storageKey}:${size}`).digest("hex").slice(0, 24)}"`;
  const headers: Record<string, string> = {
    // Only PDFs are served from here; never echo a client-supplied media
    // type (a stored "text/html" would otherwise run as a page).
    "content-type": "application/pdf",
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
    "accept-ranges": "bytes",
    etag,
    // The browser may keep it, but checks with the server first (cheap: a 304 with no body).
    "cache-control": "private, no-cache"
  };
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });

  let start = 0;
  let end = size - 1;
  const range = request.headers.get("range");
  const ranged = Boolean(range);
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const unsatisfiable = () => new NextResponse(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    if (!match || (match[1] === "" && match[2] === "")) return unsatisfiable();
    if (match[1] === "") {
      start = Math.max(0, size - Number(match[2])); // the last N bytes
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
    }
    if (start > end || start >= size) return unsatisfiable();
  }

  try {
    const stream = await openStoredFileRange(document.storageKey, start, end);
    return new NextResponse(stream, {
      status: ranged ? 206 : 200,
      headers: { ...headers, "content-length": String(end - start + 1), ...(ranged ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) }
    });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    console.error(`Could not read stored PDF for document ${documentId} at ${document.storageKey}:`, error);
    return NextResponse.json(
      { error: missing ? "The PDF record exists, but its stored file could not be found." : "The stored PDF could not be read." },
      { status: missing ? 404 : 500 }
    );
  }
}
