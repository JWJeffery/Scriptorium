import { NextRequest, NextResponse } from "next/server";
import { MAX_PDF_BYTES } from "../../../../lib/server-storage";
import { RemoteFetchError, fetchRemotePdf } from "../../../../lib/remote-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fetch the PDF behind a pasted link and hand it to the browser, which then adds it exactly as if it had been
// chosen from the device (same duplicate check, same upload). Signed-in only, like every /api route.
export async function POST(request: NextRequest) {
  let url = "";
  try { url = String(((await request.json()) as { url?: unknown }).url ?? ""); } catch { /* handled below */ }
  if (!url.trim()) return NextResponse.json({ error: "Paste a link first." }, { status: 400 });
  try {
    const { bytes, filename } = await fetchRemotePdf(url, MAX_PDF_BYTES);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "x-scriptorium-filename": encodeURIComponent(filename),
        "x-content-type-options": "nosniff",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof RemoteFetchError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[import] fetching a link failed:", error);
    return NextResponse.json({ error: "The link could not be fetched. The details are in the server log." }, { status: 500 });
  }
}
