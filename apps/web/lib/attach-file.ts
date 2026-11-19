import { createHash } from "node:crypto";

import { ApiError, conflict, notFound } from "./api-v1";
import { prisma } from "./prisma";
import { deleteStoredPdfFile, storePdfFile, storedFileSize } from "./server-storage";
import { looksLikePdf } from "./upload-guards";

// Books added with the first version were kept only in the reader's browser; the server knew the title and
// the highlights but not the file. This stores the browser's copy on the server and attaches it to the book
// that is already there, so its highlights, notes and tags stay exactly as they are.
export async function attachPdfFile(documentId: string, file: File) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } }
  });
  if (!document) throw notFound();
  if (document.kind !== "PDF") throw new ApiError(400, "invalid", "Only a PDF can be attached to this book.");
  if (document.storageKey && (await storedFileSize(document.storageKey)) !== null) {
    throw conflict("This book already has its file stored on the server.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) throw new ApiError(400, "invalid", "That is not a valid PDF.");
  const checksum = createHash("sha256").update(bytes).digest("hex");

  const stored = await storePdfFile(document.id, file);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: document.id }, data: { storageKey: stored.storageKey } });
      const version = document.versions[0];
      if (version) await tx.documentVersion.update({ where: { id: version.id }, data: { snapshotKey: stored.storageKey, sourceChecksum: checksum } });
    });
  } catch (error) {
    await deleteStoredPdfFile(stored.storageKey);
    throw error;
  }
  return { documentId: document.id, storageKey: stored.storageKey, sizeBytes: stored.size, checksum };
}
