import { NextRequest, NextResponse } from "next/server";
import { readStoredPdfFile } from "../../../../../lib/server-storage";
import { getJob } from "../../../../../lib/page-split-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const versionId = request.nextUrl.searchParams.get("versionId")?.trim();
  if (!versionId) {
    return NextResponse.json({ error: "versionId is required." }, { status: 400 });
  }

  const job = await getJob(versionId);
  if (!job || job.status !== "ready" || !job.resultStorageKey) {
    return NextResponse.json({ error: "No completed split result is available for that version." }, { status: 404 });
  }

  const bytes = await readStoredPdfFile(job.resultStorageKey);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="split-two-page-spreads.pdf"'
    }
  });
}
