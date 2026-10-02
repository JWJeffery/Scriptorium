import { NextRequest, NextResponse } from "next/server";
import { fail, text } from "../../../../lib/api-helpers";
import { loadThread } from "../../../../lib/thread-context";
import { buildThreadDocument, threadToDocx, threadToMarkdown } from "../../../../lib/thread-document";
import { safeStorageSegment } from "../../../../lib/server-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const threadId = text(request.nextUrl.searchParams.get("threadId"));
  const format = request.nextUrl.searchParams.get("format");
  if (!threadId) return fail("threadId is required.");
  if (format !== "docx" && format !== "markdown") return fail("format must be docx or markdown.");

  const thread = await loadThread(threadId);
  if (!thread) return fail("Research thread not found.", 404);

  const document = buildThreadDocument(thread);
  const base = safeStorageSegment(thread.title, "research-thread");
  if (format === "markdown") {
    return new NextResponse(threadToMarkdown(document), {
      headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${base}.md"`, "x-content-type-options": "nosniff" }
    });
  }
  const bytes = await threadToDocx(document);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${base}.docx"`,
      "x-content-type-options": "nosniff"
    }
  });
}
