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

// A PDF of image-only two-page spreads (like a scanned book), `count` pages long. Each page differs a
// little so the files are distinct. Slow to split on purpose: one render per page.
export async function spreadPdf(count, seed = 0) {
  const { createCanvas } = requireFromWeb("@napi-rs/canvas");
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  for (let n = 0; n < count; n += 1) {
    const width = 1200;
    const height = 1600;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "black";
    for (let y = 45, line = 0; y < height - 35; y += 22, line += 1) {
      context.fillRect(45 + ((line + n + seed) % 3) * 5, y, 390 + ((line + n) % 5) * 19, 5);
      context.fillRect(690 + (line % 4) * 4, y, 400 + ((line + 2 + seed) % 6) * 17, 5);
    }
    const image = await pdf.embedJpg(canvas.toBuffer("image/jpeg", 92));
    const page = pdf.addPage([width / 2, height / 2]);
    page.drawImage(image, { x: 0, y: 0, width: width / 2, height: height / 2 });
  }
  return await pdf.save();
}
