import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { listStoredFiles } from "../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORPUS_EXPORT_SCHEMA_VERSION = 1;

/**
 * Exports the full scholarly record set as one JSON bundle: documents,
 * versions, page maps, text spans, sources, annotations/tags, citations
 * (including regeneration lineage), and research threads.
 *
 * This is a metadata/database export. It does NOT embed PDF bytes or text
 * snapshot bytes inline (that would make the bundle enormous and duplicate
 * what's already checksum-addressed on disk); instead it includes a
 * `storageManifest` listing every file under SCRIPTORIUM_STORAGE_DIR so the
 * two together (this export + a filesystem copy of the storage directory)
 * constitute a complete backup. QueryLog is intentionally excluded — it's
 * telemetry, not scholarship, and isn't needed to reconstruct the corpus.
 */
export async function GET() {
  const [documents, sources, threads] = await Promise.all([
    prisma.document.findMany({
      include: {
        versions: {
          include: {
            pages: true,
            textSpans: true,
            annotations: {
              include: { tags: true, citations: true }
            }
          }
        }
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.source.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.researchThread.findMany({
      include: { items: { orderBy: { orderIndex: "asc" } }, tags: true },
      orderBy: { createdAt: "asc" }
    })
  ]);

  const storageManifest = await listStoredFiles();

  const counts = {
    documents: documents.length,
    sources: sources.length,
    annotations: documents.reduce((sum, doc) => sum + doc.versions.reduce((s, v) => s + v.annotations.length, 0), 0),
    citations: documents.reduce(
      (sum, doc) => sum + doc.versions.reduce((s, v) => s + v.annotations.reduce((s2, a) => s2 + a.citations.length, 0), 0),
      0
    ),
    threads: threads.length,
    storedFiles: storageManifest.length
  };

  return NextResponse.json({
    schemaVersion: CORPUS_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts,
    documents,
    sources,
    threads,
    storageManifest
  });
}
