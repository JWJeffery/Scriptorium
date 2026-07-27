import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { deleteStoredPdfFile, storePdfFile } from "../../../../lib/server-storage";
import { extractPdfText } from "../../../../lib/pdf-text-extraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParsedSource = {
  title: string;
  author?: string;
  place?: string;
  publisher?: string;
  year?: string;
};

function readText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parsePositivePage(value: string, fallback: number) {
  const parsed = Number(value || String(fallback));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function cslJsonFor(source: ParsedSource): Prisma.InputJsonObject {
  const numericYear = source.year ? Number(source.year) : undefined;
  const json = {
    type: "book",
    title: source.title,
    author: source.author ? [{ literal: source.author }] : undefined,
    publisher: source.publisher || undefined,
    "publisher-place": source.place || undefined,
    issued: source.year ? { "date-parts": [[Number.isFinite(numericYear) ? numericYear : source.year]] } : undefined
  };

  return JSON.parse(JSON.stringify(json)) as Prisma.InputJsonObject;
}

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return failure("PDF file is required.", 400);
  }

  if (file.type !== "application/pdf") {
    return failure("Only PDF files are accepted for Milestone 1.", 400);
  }

  const title = readText(formData, "title") || file.name.replace(/\.pdf$/i, "");
  const source: ParsedSource = {
    title,
    author: readText(formData, "author") || undefined,
    place: readText(formData, "place") || undefined,
    publisher: readText(formData, "publisher") || undefined,
    year: readText(formData, "year") || undefined
  };

  const basePdfPageIndex = parsePositivePage(readText(formData, "basePdfPageIndex"), 1);
  const baseBookPage = parsePositivePage(readText(formData, "baseBookPage"), 1);
  const currentPdfPageIndex = parsePositivePage(readText(formData, "currentPdfPageIndex"), 1);
  const bookPageLabel = readText(formData, "bookPageLabel") || String(baseBookPage + currentPdfPageIndex - basePdfPageIndex);
  const pdfBytes = Buffer.from(await file.arrayBuffer());
  let storageKeyToClean: string | undefined;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          title,
          originalFilename: file.name,
          kind: "PDF",
          mediaType: file.type,
          storageKey: null
        }
      });

      const storedFile = await storePdfFile(document.id, file);
      storageKeyToClean = storedFile.storageKey;

      const updatedDocument = await tx.document.update({
        where: { id: document.id },
        data: { storageKey: storedFile.storageKey }
      });

      // Read whatever text layer the PDF genuinely has (not OCR - see
      // lib/tesseract-ocr-provider.ts for that). Before this, PDF
      // ingestion never persisted any extracted text server-side, which
      // meant scan detection (Milestone 16/gate 17) always read 0
      // characters and flagged every PDF as likely scanned, real text
      // layer or not.
      let extraction: { pages: { pageIndex: number; text: string }[]; totalTextLength: number } = { pages: [], totalTextLength: 0 };
      let extractionState = "server-pdfjs-extraction-failed";
      try {
        extraction = await extractPdfText(pdfBytes);
        extractionState = extraction.totalTextLength > 0 ? "server-pdfjs-text-layer" : "server-pdfjs-no-text-layer";
      } catch {
        // Leave the defaults above. A failed extraction shouldn't fail the
        // whole upload - the document/file are still valid without it.
      }

      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          snapshotKind: "PDF_RENDERING",
          snapshotKey: storedFile.storageKey,
          extractionState
        }
      });

      const sourceRecord = await tx.source.create({
        data: {
          documentId: document.id,
          shortTitle: source.title,
          cslJson: cslJsonFor(source)
        }
      });

      const pageMap = await tx.pageMap.create({
        data: {
          versionId: version.id,
          pdfPageIndex: currentPdfPageIndex,
          bookPageLabel,
          numberingSystem: "ARABIC",
          confidence: "USER_CONFIRMED",
          note: `Mapping rule: PDF page ${basePdfPageIndex} = book page ${baseBookPage}`
        }
      });

      if (extraction.pages.length > 0) {
        await tx.textSpan.createMany({
          data: extraction.pages.map((page) => ({
            versionId: version.id,
            pageMapId: page.pageIndex === currentPdfPageIndex ? pageMap.id : null,
            text: page.text,
            anchor: { pdfPageIndex: page.pageIndex }
          }))
        });
      }

      storageKeyToClean = undefined;
      return {
        document: updatedDocument,
        version,
        source: sourceRecord,
        pageMap,
        storedFile,
        extraction: { pageCount: extraction.pages.length, totalTextLength: extraction.totalTextLength }
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch {
    if (storageKeyToClean) {
      await deleteStoredPdfFile(storageKeyToClean);
    }

    return failure("PDF upload could not be completed.", 500);
  }
}
