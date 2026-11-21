import { createHash } from "node:crypto";

import { ApiError, conflict, notFound } from "./api-v1";
import { prisma } from "./prisma";
import { deleteStoredPdfFile, storePdfFile, storedFileSize } from "./server-storage";
import { looksLikePdf } from "./upload-guards";
import { extractPdfText } from "./pdf-text-extraction";

// Books added with the first version were kept only in the reader's browser; the server knew the title and
// the highlights but not the file. This stores the browser's copy on the server and attaches it to the book
// that is already there, so its highlights, notes and tags stay exactly as they are.
//
// If the library remembers the original file's checksum and this file differs, it is refused (code
// "different_file") unless allowDifferent is set, because the highlights are anchored to the original's pages.
export async function attachPdfFile(documentId: string, file: File, allowDifferent = false) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    include: { versions: { orderBy: { createdAt: "desc" }, take: 1, include: { _count: { select: { textSpans: true } } } } }
  });
  if (!document) throw notFound();
  if (document.kind !== "PDF") throw new ApiError(400, "invalid", "Only a PDF can be attached to this book.");
  if (document.storageKey && (await storedFileSize(document.storageKey)) !== null) {
    throw conflict("This book already has its file stored on the server.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) throw new ApiError(400, "invalid", "That is not a valid PDF.");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const version = document.versions[0];
  if (version?.sourceChecksum && version.sourceChecksum !== checksum && !allowDifferent) {
    throw new ApiError(409, "different_file", "This is not the same file that was first added for this book.");
  }

  // A book saved without its file has no page text for search yet. Read the PDF's own text layer before
  // the transaction: a long book can take longer than a transaction may stay open.
  let extraction: { pages: { pageIndex: number; text: string }[]; state: string } | null = null;
  if (version && version._count.textSpans === 0) {
    try {
      const result = await extractPdfText(bytes);
      extraction = { pages: result.pages, state: result.totalTextLength > 0 ? "server-pdfjs-text-layer" : "server-pdfjs-no-text-layer" };
    } catch {
      extraction = { pages: [], state: "server-pdfjs-extraction-failed" };
    }
  }

  const stored = await storePdfFile(document.id, file);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: document.id }, data: { storageKey: stored.storageKey } });
      if (!version) return;
      await tx.documentVersion.update({ where: { id: version.id }, data: { snapshotKey: stored.storageKey, sourceChecksum: checksum, ...(extraction ? { extractionState: extraction.state } : {}) } });
      if (extraction && extraction.pages.length > 0) {
        await tx.textSpan.createMany({ data: extraction.pages.map((page) => ({ versionId: version.id, text: page.text, anchor: { pdfPageIndex: page.pageIndex } })) });
      }
    }, { timeout: 60_000 });
  } catch (error) {
    await deleteStoredPdfFile(stored.storageKey);
    throw error;
  }
  return { documentId: document.id, storageKey: stored.storageKey, sizeBytes: stored.size, checksum };
}
