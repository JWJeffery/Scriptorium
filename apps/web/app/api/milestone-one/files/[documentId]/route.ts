import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { readStoredPdfFile } from "../../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { documentId } = await context.params;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      originalFilename: true,
      mediaType: true,
      storageKey: true
    }
  });

  if (!document?.storageKey) {
    return NextResponse.json({ error: "Stored PDF was not found." }, { status: 404 });
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = await readStoredPdfFile(document.storageKey);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    console.error(`Could not read stored PDF for document ${documentId} at ${document.storageKey}:`, error);
    return NextResponse.json(
      { error: missing ? "The PDF record exists, but its stored file could not be found." : "The stored PDF could not be read." },
      { status: missing ? 404 : 500 }
    );
  }

  return new NextResponse(new Uint8Array(fileBuffer), {
    headers: {
      // Only PDFs are served from here; never echo a client-supplied media
      // type (a stored "text/html" would otherwise run as a page).
      "content-type": "application/pdf",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "content-length": String(fileBuffer.byteLength),
      "cache-control": "no-store"
    }
  });
}
