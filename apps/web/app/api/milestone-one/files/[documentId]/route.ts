import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { readStoredPdfFile } from "../../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { documentId } = await context.params;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      originalFilename: true,
      mediaType: true,
      storageKey: true
    }
  });

  if (!document?.storageKey) {
    return NextResponse.json({ error: "Stored PDF was not found." }, { status: 404 });
  }

  const fileBuffer = await readStoredPdfFile(document.storageKey);
  const filename = document.originalFilename || `${document.title}.pdf`;

  return new NextResponse(fileBuffer, {
    headers: {
      "content-type": document.mediaType || "application/pdf",
      "content-disposition": `inline; filename="${filename.replaceAll('"', '')}"`
    }
  });
}
