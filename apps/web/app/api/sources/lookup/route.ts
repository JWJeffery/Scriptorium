import { NextRequest, NextResponse } from "next/server";
import { fail, readJsonObject, text } from "../../../../lib/api-helpers";
import { lookupDoi, lookupIsbn, normalizeDoi, normalizeIsbn } from "../../../../lib/source-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// { query: "9780198601371" | "10.1038/nature12373" }  ->  { csl, provider, kind }
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const query = text(body.query, 200);
  if (!query) return fail("Type an ISBN or a DOI.");

  const doi = normalizeDoi(query);
  const isbn = doi ? null : normalizeIsbn(query);
  if (!doi && !isbn) return fail("That is not a valid ISBN (10 or 13 digits) or DOI (like 10.1038/nature12373). Check it for typing mistakes.");

  const found = doi ? await lookupDoi(doi) : await lookupIsbn(isbn as string);
  if (!found) return fail(`Nothing was found for ${doi ? `DOI ${doi}` : `ISBN ${isbn}`}. The catalogue may not list it; you can type the details in by hand.`, 404);
  return NextResponse.json({ kind: doi ? "doi" : "isbn", ...found });
}
