import { NextRequest, NextResponse } from "next/server";
import { POST as uploadPdf } from "../../../milestone-one/files/route";
import { prisma } from "../../../../../lib/prisma";
import { getJob } from "../../../../../lib/page-split-jobs";
import { readStoredPdfFile } from "../../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportRequest = {
  versionId?: string;
  title?: string;
};

function firstName(value: unknown) {
  if (!Array.isArray(value) || typeof value[0] !== "object" || value[0] === null) return "";
  const name = value[0] as { literal?: unknown; given?: unknown; family?: unknown };
  if (typeof name.literal === "string") return name.literal;
  return [name.given, name.family]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .join(" ");
}

function basicMetadata(value: unknown) {
  const csl = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const issued = typeof csl.issued === "object" && csl.issued !== null
    ? (csl.issued as { "date-parts"?: unknown })["date-parts"]
    : undefined;
  const year = Array.isArray(issued) && Array.isArray(issued[0]) && (typeof issued[0][0] === "string" || typeof issued[0][0] === "number")
    ? String(issued[0][0])
    : "";
  return {
    author: firstName(csl.author),
    title: typeof csl.title === "string" ? csl.title : "",
    place: typeof csl["publisher-place"] === "string" ? csl["publisher-place"] : "",
    publisher: typeof csl.publisher === "string" ? csl.publisher : "",
    year
  };
}

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
    const originalVersion = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { sources: { orderBy: { createdAt: "asc" }, take: 1 } } } }
    });
    const originalSource = originalVersion?.document.sources[0];
    const bytes = await readStoredPdfFile(job.resultStorageKey);
    const formData = new FormData();
    formData.set("file", new File([bytes as BlobPart], "split-two-page-spreads.pdf", { type: "application/pdf" }));
    formData.set("title", title);

    const internalRequest = new NextRequest(new URL("/api/milestone-one/files", request.url), {
      method: "POST",
      body: formData
    });
    const uploadResponse = await uploadPdf(internalRequest);
    if (!uploadResponse.ok || !originalSource) return uploadResponse;

    const uploaded = await uploadResponse.json() as {
      source?: { id?: string };
      [key: string]: unknown;
    };
    if (!uploaded.source?.id) return NextResponse.json(uploaded, { status: uploadResponse.status });

    const source = await prisma.source.update({
      where: { id: uploaded.source.id },
      data: {
        shortTitle: originalSource.shortTitle,
        cslJson: JSON.parse(JSON.stringify(originalSource.cslJson))
      }
    });

    return NextResponse.json({
      ...uploaded,
      source,
      sourceMetadata: basicMetadata(source.cslJson)
    }, { status: uploadResponse.status });
  } catch (error) {
    console.error(`Could not import split result for version ${versionId}:`, error);
    return NextResponse.json({ error: "The split PDF could not be imported as a new document." }, { status: 500 });
  }
}
