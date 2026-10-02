import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { fail, readJsonObject, text } from "../../../lib/api-helpers";
import { loadThread } from "../../../lib/thread-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanTags(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => text(value, 128)).filter(Boolean))).slice(0, 25);
}

export async function GET(request: NextRequest) {
  const threadId = text(request.nextUrl.searchParams.get("threadId"));
  if (threadId) {
    const thread = await loadThread(threadId);
    return thread ? NextResponse.json({ thread }) : fail("Research thread not found.", 404);
  }
  const threads = await prisma.researchThread.findMany({
    orderBy: { updatedAt: "desc" },
    include: { tags: { orderBy: { value: "asc" } }, _count: { select: { items: true } } }
  });
  return NextResponse.json({
    threads: threads.map((thread) => ({ id: thread.id, title: thread.title, description: thread.description ?? "", tags: thread.tags.map((tag) => tag.value), itemCount: thread._count.items, updatedAt: thread.updatedAt }))
  });
}

export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const title = text(body.title, 512);
  if (!title) return fail("A thread needs a title.");
  const thread = await prisma.researchThread.create({
    data: { title, description: text(body.description) || null, tags: { create: cleanTags(body.tags).map((value) => ({ value })) } }
  });
  return NextResponse.json({ thread: await loadThread(thread.id) }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const threadId = text(body.threadId);
  if (!threadId) return fail("threadId is required.");
  if (!(await prisma.researchThread.findUnique({ where: { id: threadId }, select: { id: true } }))) return fail("Research thread not found.", 404);

  const title = body.title === undefined ? undefined : text(body.title, 512);
  if (title === "") return fail("A thread needs a title.");
  await prisma.$transaction(async (tx) => {
    await tx.researchThread.update({
      where: { id: threadId },
      data: { title, description: body.description === undefined ? undefined : text(body.description) || null }
    });
    if (body.tags !== undefined) {
      await tx.researchThreadTag.deleteMany({ where: { researchThreadId: threadId } });
      const tags = cleanTags(body.tags);
      if (tags.length) await tx.researchThreadTag.createMany({ data: tags.map((value) => ({ researchThreadId: threadId, value })) });
    }
  });
  return NextResponse.json({ thread: await loadThread(threadId) });
}

export async function DELETE(request: NextRequest) {
  const threadId = text(request.nextUrl.searchParams.get("threadId"));
  if (!threadId) return fail("threadId is required.");
  if (!(await prisma.researchThread.findUnique({ where: { id: threadId }, select: { id: true } }))) return fail("Research thread not found.", 404);
  await prisma.researchThread.delete({ where: { id: threadId } });
  return NextResponse.json({ deleted: true, threadId });
}
