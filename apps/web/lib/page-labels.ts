// Turns a PDF page number into the book's printed page label.
// Today a document has one linear rule, stored in the PageMap note as
// "Mapping rule: PDF page X = book page Y". (Numbering ranges, such as a
// Roman-numeral preface, are layered on top of this later.)

export function parseMappingRule(note: string | null | undefined): { basePdfPage: number; baseBookPage: number } {
  const match = /PDF page (\d+) = book page (\d+)/.exec(note ?? "");
  return match ? { basePdfPage: Number(match[1]), baseBookPage: Number(match[2]) } : { basePdfPage: 1, baseBookPage: 1 };
}

export function bookLabelFromRule(note: string | null | undefined, pdfPage: number): string {
  const rule = parseMappingRule(note);
  return String(rule.baseBookPage + pdfPage - rule.basePdfPage);
}
