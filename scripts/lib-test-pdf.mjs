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

// A scanned book: every page is only a picture of printed English text (no text layer), so OCR has
// real words to read. Every third page is a two-page spread (two text blocks with a blank gutter), the
// layout the OCR splits into two halves. Deterministic: the same arguments give the same file.
const SCAN_WORDS = "the of and to in that is was he for it with as his on be at by had this not are but from or have an they which one you were her all she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three".split(" ");

export async function scannedTextPdf(count, seed = 0) {
  const { createCanvas } = requireFromWeb("@napi-rs/canvas");
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  let w = seed;
  const line = (n) => Array.from({ length: n }, () => SCAN_WORDS[(w = (w * 31 + 7) % SCAN_WORDS.length)]).join(" ");
  for (let n = 0; n < count; n += 1) {
    const spread = n % 3 === 2;
    const width = spread ? 1600 : 800;
    const height = 1000;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "black";
    context.font = "26px 'Liberation Serif'";
    for (const x of spread ? [60, 860] : [60]) {
      context.fillText(`Page ${n + 1}`, x, 70);
      for (let row = 0; row < 12; row += 1) context.fillText(line(7), x, 130 + row * 44);
    }
    if (n % 4 === 3) {
      // A badly smudged page, so the OCR's low-confidence warnings have something to report.
      let r = seed + n;
      for (let i = 0; i < 5000; i += 1) {
        r = (r * 1103515245 + 12345) % 2147483648;
        context.fillStyle = i % 2 ? "black" : "white";
        context.fillRect(r % width, (r >> 8) % height, 4 + (r % 13), 2 + ((r >> 4) % 5));
      }
    }
    const image = await pdf.embedJpg(canvas.toBuffer("image/jpeg", 92));
    const page = pdf.addPage([width / 2, height / 2]);
    page.drawImage(image, { x: 0, y: 0, width: width / 2, height: height / 2 });
  }
  return await pdf.save();
}
