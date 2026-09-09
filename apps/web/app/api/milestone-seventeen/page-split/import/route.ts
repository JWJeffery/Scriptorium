import { NextRequest, NextResponse } from "next/server";
import { POST as uploadPdf } from "../../../milestone-one/files/route";
import { getJob } from "../../../../../lib/page-split-jobs";
import { readStoredPdfFile } from "../../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportRequest = {
  versionId?: string;
  title?: string;
};

export async function POST(request: NextRequest) {
  let body: ImportRequest;
  try {
    body = (await request.json()) as ImportRequest;
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  const versionId = body.versionId?.trim();
  const title = body.title?.trim();
  if (!versionId || !title) {
    return NextResponse.json({ error: "versionId and title are required." }, { status: 400 });
  }

  const job = await getJob(versionId);
  if (!job || job.status !== "ready" || !job.resultStorageKey) {
    return NextResponse.json({ error: "No completed split result is available for that version." }, { status: 404 });
  }

  try {
    // Keep the book-sized PDF on the server. The earlier UI downloaded the
    // entire split result into the browser and then uploaded the same bytes
    // back through the Codespaces proxy; real books can exceed that proxy's
    // multipart request limit even though Scriptorium already has the file.
    // Reusing the normal PDF upload handler here preserves exactly the same
    // database, storage, source, page-map, and text-extraction behavior without
    // the unnecessary network round trip.
    const bytes = await readStoredPdfFile(job.resultStorageKey);
    const formData = new FormData();
    formData.set("file", new File([bytes as BlobPart], "split-two-page-spreads.pdf", { type: "application/pdf" }));
    formData.set("title", title);

    const internalRequest = new NextRequest(new URL("/api/milestone-one/files", request.url), {
      method: "POST",
      body: formData
    });
    return await uploadPdf(internalRequest);
  } catch (error) {
    console.error(`Could not import split result for version ${versionId}:`, error);
    return NextResponse.json({ error: "The split PDF could not be imported as a new document." }, { status: 500 });
  }
}
