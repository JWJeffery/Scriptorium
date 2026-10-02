import { prisma } from "./prisma";
import { legacyRange, type NumberingSystem, type PageRangeSpec } from "./page-labels";

export async function loadRanges(versionId: string): Promise<{ ranges: PageRangeSpec[]; source: "saved" | "legacy" } | null> {
  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    select: { pageRanges: { orderBy: { startPdfPage: "asc" } }, pages: { orderBy: { pdfPageIndex: "asc" }, take: 1, select: { note: true } } }
  });
  if (!version) return null;
  if (version.pageRanges.length > 0) {
    return {
      source: "saved",
      ranges: version.pageRanges.map((range) => ({ startPdfPage: range.startPdfPage, endPdfPage: range.endPdfPage, system: range.system as NumberingSystem, startValue: range.startValue, prefix: range.prefix }))
    };
  }
  return { source: "legacy", ranges: [legacyRange(version.pages[0]?.note)] };
}
