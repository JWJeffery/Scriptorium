import { NextRequest, NextResponse } from "next/server";
import { BoxError, connectBox } from "../../../../../lib/box";
import { publicOrigin } from "../../../../../lib/public-origin";
import { secretsMatch } from "../../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 2: Box sends the browser back here with a one-time code, exchanged for tokens kept on the server.
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const back = (result: string) => {
    const response = NextResponse.redirect(`${origin}/?box=${result}`, 302);
    response.cookies.set("scriptorium_box_state", "", { path: "/api/import/box", maxAge: 0 });
    return response;
  };
  const params = request.nextUrl.searchParams;
  const expected = request.cookies.get("scriptorium_box_state")?.value ?? "";
  if (params.get("error")) return back("cancelled");
  if (!expected || !(await secretsMatch(params.get("state") ?? "", expected)) || !params.get("code")) return back("failed");
  try {
    await connectBox(params.get("code") as string, `${origin}/api/import/box/callback`);
    return back("connected");
  } catch (error) {
    if (!(error instanceof BoxError)) console.error("[box] connecting failed:", error);
    return back("failed");
  }
}
