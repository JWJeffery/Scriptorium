import { NextRequest, NextResponse } from "next/server";
import { fail, text } from "../../../../lib/api-helpers";
import { loadDocumentAnnotations } from "../../../../lib/thread-context";
import { buildThreadDocument, renderNotes, threadToDocx, threadToMarkdown } from "../../../../lib/thread-document";
import { highlightColors } from "../../../../lib/highlights";
import { safeStorageSegment } from "../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: string) {
  // Spreadsheets run text that starts with = + - @ as a formula; neutralise that.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

// Every annotation in one document, in reading order, as Word, Markdown or CSV.
export async function GET(request: NextRequest) {
  const documentId = text(request.nextUrl.searchParams.get("documentId"));
  const format = request.nextUrl.searchParams.get("format");
  if (!documentId) return fail("documentId is required.");
  if (format !== "docx" && format !== "markdown" && format !== "csv") return fail("format must be docx, markdown or csv.");

  const annotations = await loadDocumentAnnotations(documentId);
  if (!annotations) return fail("Document not found.", 404);
  const base = safeStorageSegment(annotations.title, "annotations");

  if (format === "csv") {
    const rows: string[][] = [["Book page", "PDF page", "Meaning", "Tags", "Passage", "Note", "Citation"]];
    for (const item of annotations.items) {
      const context = item.context;
      if (!context || context.itemType !== "ANNOTATION") continue;
      const meaning = highlightColors.find((color) => color.key === context.colorKey)?.defaultMeaning ?? context.colorKey;
      rows.push([context.bookPage ?? "", context.pdfPageIndex === null ? "" : String(context.pdfPageIndex), meaning, context.tags.join("; "), context.selectedText, context.note, context.citationText]);
    }
    // The BOM makes Excel read the file as UTF-8 (Greek, Hebrew and accents survive).
    const body = `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    return new NextResponse(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"`, "x-content-type-options": "nosniff" } });
  }

  const document = buildThreadDocument(annotations);
  const rendered = renderNotes(document, text(request.nextUrl.searchParams.get("style")) || "sbl-note");
  if (format === "markdown") {
    return new NextResponse(threadToMarkdown(document, rendered), { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${base}.md"`, "x-content-type-options": "nosniff" } });
  }
  const bytes = await threadToDocx(document, rendered);
  return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": `attachment; filename="${base}.docx"`, "x-content-type-options": "nosniff" } });
}
