import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { deleteStoredPdfFile, readStoredPdfFile, storePdfFile } from "../../../../../lib/server-storage";
import { extractPdfText } from "../../../../../lib/pdf-text-extraction";
import { looksLikePdf } from "../../../../../lib/upload-guards";
import { sha256Hex } from "../../../../../lib/library";

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

// Attach the PDF itself to a book that is already in the library but has no
// file stored on the server (an upload that never arrived, or a stored file
// that has gone missing). The book keeps its id, notes and highlights; only
// the file is filled in. A book whose file is present is left untouched.
// If the library knows the original file's checksum and this file differs,
// the request is refused unless allowDifferent=true, because highlights are
// anchored to the original's pages.
export async function PUT(request: NextRequest, context: RouteContext) {
  const { documentId } = await context.params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "The file did not arrive complete. Please try again." }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "PDF file is required." }, { status: 400 });

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, kind: true, storageKey: true, deletedAt: true, versions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, sourceChecksum: true, _count: { select: { textSpans: true } } } } }
  });
  if (!document || document.deletedAt) return NextResponse.json({ error: "That book is not in the library." }, { status: 404 });
  if (document.kind !== "PDF") return NextResponse.json({ error: "Only PDF books can have a PDF attached." }, { status: 400 });

  if (document.storageKey) {
    try {
      await readStoredPdfFile(document.storageKey);
      return NextResponse.json({ document: { id: document.id, storageKey: document.storageKey }, alreadyStored: true });
    } catch {
      // The record points at a file that is gone; replace it below.
    }
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return NextResponse.json({ error: "The chosen file is not a valid PDF." }, { status: 400 });
  const pdfFile = file.type === "application/pdf" ? file : new File([bytes], file.name || "document.pdf", { type: "application/pdf" });

  const checksum = sha256Hex(bytes);
  const version = document.versions[0];
  const allowDifferent = readFlag(formData.get("allowDifferent")) || request.nextUrl.searchParams.get("allowDifferent") === "true";
  if (version?.sourceChecksum && version.sourceChecksum !== checksum && !allowDifferent) {
    return NextResponse.json({ error: "This is not the same file that was first added for this book.", code: "different_file" }, { status: 409 });
  }

  let stored: { storageKey: string };
  try {
    stored = await storePdfFile(document.id, pdfFile);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The PDF could not be stored." }, { status: 400 });
  }

  // Read the PDF's own text layer before opening the database transaction:
  // a long book can take far longer than a transaction is allowed to stay open.
  // (A book saved without its file has no page text for search yet.)
  let extraction: { pages: { pageIndex: number; text: string }[]; state: string } | null = null;
  if (version && version._count.textSpans === 0) {
    try {
      const result = await extractPdfText(bytes);
      extraction = { pages: result.pages, state: result.totalTextLength > 0 ? "server-pdfjs-text-layer" : "server-pdfjs-no-text-layer" };
    } catch {
      extraction = { pages: [], state: "server-pdfjs-extraction-failed" };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: document.id }, data: { storageKey: stored.storageKey } });
      if (!version) return;
      const data: { snapshotKey: string; sourceChecksum?: string; extractionState?: string } = { snapshotKey: stored.storageKey };
      if (!version.sourceChecksum || allowDifferent) data.sourceChecksum = checksum;
      if (extraction) {
        data.extractionState = extraction.state;
        if (extraction.pages.length > 0) {
          await tx.textSpan.createMany({ data: extraction.pages.map((page) => ({ versionId: version.id, text: page.text, anchor: { pdfPageIndex: page.pageIndex } })) });
        }
      }
      await tx.documentVersion.update({ where: { id: version.id }, data });
    }, { timeout: 60_000 });
  } catch {
    if (stored.storageKey !== document.storageKey) await deleteStoredPdfFile(stored.storageKey).catch(() => undefined);
    return NextResponse.json({ error: "The PDF could not be saved to the library." }, { status: 500 });
  }

  return NextResponse.json({ document: { id: document.id, storageKey: stored.storageKey }, alreadyStored: false }, { status: 201 });
}

function readFlag(value: FormDataEntryValue | null) {
  return typeof value === "string" && value === "true";
}
