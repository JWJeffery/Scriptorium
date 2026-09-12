import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { extractDocxRawText } from "../../../lib/docx-extraction";
import { analyzeReadingNotes, parseReadingNotes, type ReadingNoteCandidate, type ReadingNotesPage } from "../../../lib/reading-notes-import";
import { formatCitation, isCitationStyleId, type CslItem } from "../../../lib/citation-styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function numericField(formData: FormData, name: string, fallback: number) {
  const value = Number(formData.get(name));
  return Number.isFinite(value) ? value : fallback;
}

function isDocx(file: File) {
  return file.name.toLowerCase().endsWith(".docx") || file.type === DOCX_MEDIA_TYPE;
}

function wordsFromAnchor(anchor: unknown) {
  if (!anchor || typeof anchor !== "object" || !("words" in anchor) || !Array.isArray(anchor.words)) return [];
  return anchor.words.filter((word): word is ReadingNotesPage["words"][number] => {
    if (!word || typeof word !== "object") return false;
    const candidate = word as Record<string, unknown>;
    return typeof candidate.text === "string" && [candidate.left, candidate.top, candidate.width, candidate.height].every((value) => typeof value === "number");
  });
}

function pageIndexFromAnchor(anchor: unknown) {
  if (!anchor || typeof anchor !== "object" || !("pdfPageIndex" in anchor)) return undefined;
  return typeof anchor.pdfPageIndex === "number" ? anchor.pdfPageIndex : undefined;
}

function citationText(cslJson: Prisma.JsonValue, style: string, locator: string) {
  if (!isCitationStyleId(style)) throw new Error("Unsupported citation style.");
  return formatCitation(cslJson as CslItem, style, { type: "page", value: locator }).replace(/<\/?i>/g, "");
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  const documentId = String(formData.get("documentId") ?? "").trim();
  const versionId = String(formData.get("versionId") ?? "").trim();
  const sourceId = String(formData.get("sourceId") ?? "").trim();
  const citationStyle = String(formData.get("citationStyle") ?? "sbl-note").trim();
  if (!(file instanceof File) || !isDocx(file) || !documentId || !versionId || !sourceId || !isCitationStyleId(citationStyle)) {
    return NextResponse.json({ error: "A DOCX notes file and a registered PDF are required." }, { status: 400 });
  }

  const [version, source, extraction] = await Promise.all([
    prisma.documentVersion.findFirst({ where: { id: versionId, documentId }, select: { id: true } }),
    prisma.source.findFirst({ where: { id: sourceId, documentId }, select: { id: true, cslJson: true } }),
    extractDocxRawText(file)
  ]);
  if (!version || !source) return NextResponse.json({ error: "The registered PDF record could not be found." }, { status: 404 });

  const spans = await prisma.textSpan.findMany({ where: { versionId }, select: { text: true, anchor: true } });
  const pages: ReadingNotesPage[] = spans.flatMap((span) => {
    const pageIndex = pageIndexFromAnchor(span.anchor);
    return pageIndex === undefined ? [] : [{ pageIndex, text: span.text, words: wordsFromAnchor(span.anchor) }];
  });
  const parsed = parseReadingNotes(extraction.text);
  const candidates = analyzeReadingNotes(parsed, pages, {
    basePdfPageIndex: numericField(formData, "basePdfPageIndex", 1),
    baseBookPage: numericField(formData, "baseBookPage", 1)
  }).map((candidate) => ({ ...candidate, citationText: citationText(source.cslJson, citationStyle, candidate.pageLabel) }));

  return NextResponse.json({
    filename: file.name,
    warningCount: extraction.warningCount,
    ocrPageCount: pages.filter((page) => page.words.length > 0).length,
    parsedCount: parsed.length,
    candidates,
    summary: {
      high: candidates.filter((candidate) => candidate.matchStatus === "high").length,
      review: candidates.filter((candidate) => candidate.matchStatus === "review").length,
      unmatched: candidates.filter((candidate) => candidate.matchStatus === "unmatched").length,
      pageNotes: candidates.filter((candidate) => candidate.matchStatus === "page-note").length
    }
  });
}

type ImportCandidate = Pick<ReadingNoteCandidate, "id" | "pageLabel" | "pdfPageIndex" | "selectedText" | "note" | "anchor" | "kind"> & {
  colorKey?: string;
};

type ImportPayload = {
  documentId?: string;
  versionId?: string;
  sourceId?: string;
  citationStyle?: string;
  candidates?: ImportCandidate[];
};

function validImportCandidate(candidate: ImportCandidate) {
  if (!candidate || typeof candidate !== "object") return false;
  if (typeof candidate.id !== "string" || typeof candidate.pageLabel !== "string" || typeof candidate.selectedText !== "string" || typeof candidate.note !== "string") return false;
  if (candidate.kind !== "highlight" && candidate.kind !== "page-note") return false;
  if (!candidate.selectedText.trim() && !candidate.note.trim()) return false;
  if (candidate.kind === "highlight") {
    if (!candidate.anchor || typeof candidate.anchor.pageNumber !== "number" || !Array.isArray(candidate.anchor.rects) || candidate.anchor.rects.length === 0) return false;
  }
  return true;
}

export async function PUT(request: NextRequest) {
  const body = await request.json() as ImportPayload;
  const documentId = body.documentId?.trim();
  const versionId = body.versionId?.trim();
  const sourceId = body.sourceId?.trim();
  const style = body.citationStyle?.trim() ?? "sbl-note";
  const candidates = body.candidates ?? [];
  if (!documentId || !versionId || !sourceId || !isCitationStyleId(style) || candidates.length === 0 || candidates.length > 500 || !candidates.every(validImportCandidate)) {
    return NextResponse.json({ error: "The reading-note import payload is invalid." }, { status: 400 });
  }

  const [version, source, pageMaps] = await Promise.all([
    prisma.documentVersion.findFirst({ where: { id: versionId, documentId }, select: { id: true } }),
    prisma.source.findFirst({ where: { id: sourceId, documentId }, select: { id: true, cslJson: true, updatedAt: true } }),
    prisma.pageMap.findMany({ where: { versionId }, select: { id: true, pdfPageIndex: true } })
  ]);
  if (!version || !source) return NextResponse.json({ error: "The registered PDF record could not be found." }, { status: 404 });

  const records = await prisma.$transaction(async (tx) => {
    const imported = [];
    for (const candidate of candidates) {
      const pageMapId = pageMaps.find((pageMap) => pageMap.pdfPageIndex === candidate.pdfPageIndex)?.id ?? null;
      const anchor = candidate.kind === "highlight" && candidate.anchor
        ? JSON.parse(JSON.stringify(candidate.anchor)) as Prisma.InputJsonObject
        : undefined;
      const annotation = await tx.annotation.create({
        data: {
          documentId,
          versionId,
          pageMapId,
          colorKey: candidate.colorKey?.trim() || "yellow",
          selectedText: candidate.kind === "page-note" ? "" : candidate.selectedText.trim(),
          note: candidate.note.trim() || null,
          anchor,
          tags: { create: [{ value: "imported-reading-notes" }] }
        }
      });
      const generatedText = citationText(source.cslJson, style, candidate.pageLabel);
      const citation = await tx.citation.create({
        data: {
          sourceId,
          annotationId: annotation.id,
          styleId: style,
          locatorType: "page",
          locatorValue: candidate.pageLabel,
          generatedText,
          sourceSnapshotUpdatedAt: source.updatedAt
        }
      });
      imported.push({
        id: candidate.id,
        annotationId: annotation.id,
        citationId: citation.id,
        selectedText: annotation.selectedText,
        note: annotation.note ?? "",
        colorKey: annotation.colorKey,
        pdfPageIndex: candidate.pdfPageIndex ?? 1,
        bookPageLabel: candidate.pageLabel,
        anchor: candidate.kind === "highlight" ? candidate.anchor : undefined,
        citationStyle: style,
        citationText: generatedText,
        createdAt: annotation.createdAt.toISOString()
      });
    }
    return imported;
  });

  return NextResponse.json({ importedCount: records.length, records }, { status: 201 });
}
