import { NextRequest, NextResponse } from "next/server";
import { fail, readJsonObject } from "../../../../lib/api-helpers";
import { MAX_IMPORT_CHARS, parseBibliographyText } from "../../../../lib/source-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// { text }  ->  { entries: [CSL JSON...] }   (BibTeX, RIS or CSL JSON)
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body || typeof body.text !== "string") return fail("text is required.");
  if (body.text.length > MAX_IMPORT_CHARS) return fail("That file is too large to import.", 413);
  try {
    return NextResponse.json({ entries: parseBibliographyText(body.text) });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Import failed.");
  }
}
