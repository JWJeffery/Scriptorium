import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public liveness check for Docker and uptime monitors: is the app up and can it reach its database?
// It says nothing about the library itself.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[health] database check failed:", error);
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
