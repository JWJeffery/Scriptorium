import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const documentId = request.nextUrl.searchParams.get("documentId");

  if (!documentId) {
    return NextResponse.json({ error: "documentId is required." }, { status: 400 });
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      versions: {
        orderBy: { createdAt: "desc" },
        include: {
          pages: true,
          textSpans: true,
          annotations: {
            orderBy: { createdAt: "desc" },
            include: { citations: true }
          }
        }
      },
      sources: true
    }
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({ document });
}
