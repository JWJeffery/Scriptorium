// Test helper: builds a small PDF with real, extractable text on each page.
import { createRequire } from "node:module";
const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { PDFDocument, StandardFonts } = requireFromWeb("pdf-lib");

export async function textPdf(pages) {
  // Fixed dates, so the same pages always give byte-identical files (duplicate-detection tests rely on it).
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([420, 560]);
    lines.forEach((line, i) => page.drawText(line, { x: 40, y: 500 - i * 22, size: 13, font }));
  }
  return await pdf.save();
}
