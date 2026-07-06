import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { deleteStoredPdfFile, storePdfFile } from "../../../../lib/server-storage";

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
  const cslItem: Prisma.InputJsonObject = {
    type: "book",
    title: source.title
  };

  if (source.author) cslItem.author = [{ literal: source.author }];
  if (source.publisher) cslItem.publisher = source.publisher;
  if (source.place) cslItem["publisher-place"] = source.place;

  if (source.year) {
    const numericYear = Number(source.year);
    cslItem.issued = {
      "date-parts": [[Number.isFinite(numericYear) ? numericYear : source.year]]
    };
  }

  return cslItem;
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

      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          snapshotKind: "PDF_RENDERING",
          snapshotKey: storedFile.storageKey,
          extractionState: "browser-local-pdfjs"
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

      storageKeyToClean = undefined;
      return { document: updatedDocument, version, source: sourceRecord, pageMap, storedFile };
    });

    return NextResponse.json(result, { status: 201 });
  } catch {
    if (storageKeyToClean) {
      await deleteStoredPdfFile(storageKeyToClean);
    }

    return failure("PDF upload could not be completed.", 500);
  }
}
