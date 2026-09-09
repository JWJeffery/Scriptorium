import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import type { OcrWord } from "./ocr-provider";

export type OcrPageLayer = {
  pageIndex: number;
  words: OcrWord[];
};

export type SearchablePdfResult = {
  pdfBytes: Uint8Array;
  embeddedWordCount: number;
  pageCount: number;
};

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function finiteCoordinate(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function encodableText(font: PDFFont, raw: string) {
  const replacements: Record<string, string> = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u2026": "...",
    "\ufb01": "fi",
    "\ufb02": "fl"
  };
  const normalized = Array.from(raw.trim(), (character) => replacements[character] ?? character).join("");
  let result = "";
  for (const character of normalized) {
    try {
      font.encodeText(character);
      result += character;
    } catch {
      // The current OCR provider is English/Latin. Drop the rare glyph a
      // built-in WinAnsi font cannot represent instead of failing the whole
      // 128-page export because of one recognition artifact.
    }
  }
  return result.trim();
}

/**
 * Adds an invisible OCR layer to an image-backed PDF. Tesseract positions
 * are stored in PDF-point coordinates measured from the top-left; PDF text
 * uses a bottom-left origin, so y is inverted for each page.
 */
export async function createSearchablePdf(pdfBytes: Buffer | Uint8Array, layers: OcrPageLayer[]): Promise<SearchablePdfResult> {
  const document = await PDFDocument.load(pdfBytes instanceof Buffer ? new Uint8Array(pdfBytes) : pdfBytes);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = document.getPages();
  let embeddedWordCount = 0;

  for (const layer of layers) {
    const page = pages[layer.pageIndex - 1];
    if (!page) continue;
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    for (const word of layer.words) {
      if (![word.left, word.top].every(finiteCoordinate) || ![word.width, word.height].every(finitePositive)) continue;
      const text = encodableText(font, word.text);
      if (!text) continue;

      const widthAtOnePoint = font.widthOfTextAtSize(text, 1);
      if (!finitePositive(widthAtOnePoint)) continue;
      const fontSize = Math.max(1, Math.min(word.height * 0.9, word.width / widthAtOnePoint));
      const x = Math.max(0, Math.min(word.left, pageWidth - 1));
      const y = Math.max(0, Math.min(pageHeight - word.top - word.height, pageHeight - 1));

      // Opacity zero leaves the scan visually unchanged while producing a
      // genuine PDF text object that normal viewers can search, select, and
      // copy after the file leaves Scriptorium.
      page.drawText(text, { x, y, size: fontSize, font, opacity: 0 });
      embeddedWordCount += 1;
    }
  }

  return {
    pdfBytes: await document.save(),
    embeddedWordCount,
    pageCount: pages.length
  };
}
