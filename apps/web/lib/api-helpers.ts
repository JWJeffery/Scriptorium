import { NextResponse } from "next/server";

// Small helpers shared by the newer API routes.

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function text(value: unknown, max = 100_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
