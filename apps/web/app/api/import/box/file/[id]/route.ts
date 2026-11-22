import { NextResponse } from "next/server";
import { BoxError, downloadBoxFile } from "../../../../../../lib/box";
import { MAX_PDF_BYTES } from "../../../../../../lib/server-storage";
import { looksLikePdf } from "../../../../../../lib/upload-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Download one PDF from Box and hand it to the browser, which adds it like any other file.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { bytes, filename } = await downloadBoxFile((await context.params).id, MAX_PDF_BYTES);
    if (!looksLikePdf(bytes)) return NextResponse.json({ error: "That Box file is not a PDF." }, { status: 415 });
    return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "x-scriptorium-filename": encodeURIComponent(filename), "x-content-type-options": "nosniff", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof BoxError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[box] download failed:", error);
    return NextResponse.json({ error: "The file could not be downloaded from Box." }, { status: 502 });
  }
}
