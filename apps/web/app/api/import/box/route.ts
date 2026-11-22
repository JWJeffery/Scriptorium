import { NextResponse } from "next/server";
import { disconnectBox } from "../../../../lib/box";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Forget the Box sign-in (the tokens are deleted from this server).
export async function DELETE() {
  await disconnectBox();
  return NextResponse.json({ ok: true });
}
