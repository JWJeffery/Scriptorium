import { NextResponse } from "next/server";
import { boxConfigured, boxConnection } from "../../../../lib/box";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which ways of adding a book are set up on this server. The Google values are public by design (the browser
// needs them to open Google's own file picker); nothing secret is returned.
export async function GET() {
  const clientId = process.env.SCRIPTORIUM_GOOGLE_CLIENT_ID?.trim();
  const apiKey = process.env.SCRIPTORIUM_GOOGLE_API_KEY?.trim();
  const appId = process.env.SCRIPTORIUM_GOOGLE_APP_ID?.trim();
  const box = boxConfigured() ? await boxConnection().catch(() => null) : null;
  return NextResponse.json({
    google: clientId && apiKey ? { clientId, apiKey, appId: appId ?? null } : null,
    box: boxConfigured() ? { connected: Boolean(box), account: box?.account ?? null } : null
  }, { headers: { "cache-control": "no-store" } });
}
