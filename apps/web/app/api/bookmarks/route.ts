import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { fail, readJsonObject, text } from "../../../lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (bookmark: { id: string; pdfPage: number; label: string | null; createdAt: Date }) => ({ id: bookmark.id, pdfPage: bookmark.pdfPage, label: bookmark.label ?? "", createdAt: bookmark.createdAt });

export async function GET(request: NextRequest) {
  const documentId = text(request.nextUrl.searchParams.get("documentId"));
  if (!documentId) return fail("documentId is required.");
  const bookmarks = await prisma.bookmark.findMany({ where: { documentId }, orderBy: { pdfPage: "asc" } });
  return NextResponse.json({ bookmarks: bookmarks.map(view) });
}

// Mark a page. Marking a page that is already marked just updates its label.
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const documentId = text(body.documentId);
  const pdfPage = Number(body.pdfPage);
  if (!documentId || !Number.isInteger(pdfPage) || pdfPage < 1) return fail("documentId and a PDF page number are required.");
  if (!(await prisma.document.findUnique({ where: { id: documentId }, select: { id: true } }))) return fail("Document not found.", 404);
  const label = text(body.label, 255) || null;
  const bookmark = await prisma.bookmark.upsert({
    where: { documentId_pdfPage: { documentId, pdfPage } },
    create: { documentId, pdfPage, label },
    update: body.label === undefined ? {} : { label }
  });
  return NextResponse.json({ bookmark: view(bookmark) }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const id = text(request.nextUrl.searchParams.get("id"));
  const documentId = text(request.nextUrl.searchParams.get("documentId"));
  const pdfPage = Number(request.nextUrl.searchParams.get("pdfPage"));
  if (id) {
    const removed = await prisma.bookmark.deleteMany({ where: { id } });
    return removed.count ? NextResponse.json({ deleted: true }) : fail("Bookmark not found.", 404);
  }
  if (documentId && Number.isInteger(pdfPage)) {
    const removed = await prisma.bookmark.deleteMany({ where: { documentId, pdfPage } });
    return removed.count ? NextResponse.json({ deleted: true }) : fail("Bookmark not found.", 404);
  }
  return fail("Give an id, or a documentId and pdfPage.");
}
