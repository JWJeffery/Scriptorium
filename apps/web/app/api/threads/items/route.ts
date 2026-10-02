import { NextRequest, NextResponse } from "next/server";
import type { ResearchThreadItemType } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { fail, readJsonObject, text } from "../../../../lib/api-helpers";
import { loadThread } from "../../../../lib/thread-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITEM_TYPES = new Set<string>(["DOCUMENT", "ANNOTATION", "CITATION", "SOURCE", "NOTE"]);

async function targetExists(itemType: string, itemId: string) {
  switch (itemType) {
    case "ANNOTATION": return Boolean(await prisma.annotation.findUnique({ where: { id: itemId }, select: { id: true } }));
    case "CITATION": return Boolean(await prisma.citation.findUnique({ where: { id: itemId }, select: { id: true } }));
    case "SOURCE": return Boolean(await prisma.source.findUnique({ where: { id: itemId }, select: { id: true } }));
    case "DOCUMENT": return Boolean(await prisma.document.findUnique({ where: { id: itemId }, select: { id: true } }));
    default: return true;
  }
}

// Add an item to the end of a thread. Adding something already in the thread is
// a no-op rather than a duplicate.
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const threadId = text(body.threadId);
  const itemType = text(body.itemType);
  if (!threadId || !ITEM_TYPES.has(itemType)) return fail("threadId and a valid itemType are required.");
  if (!(await prisma.researchThread.findUnique({ where: { id: threadId }, select: { id: true } }))) return fail("Research thread not found.", 404);

  const note = text(body.note) || null;
  let itemId = text(body.itemId);
  if (itemType === "NOTE") {
    if (!note) return fail("A note item needs text.");
    itemId = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  } else {
    if (!itemId) return fail("itemId is required.");
    if (!(await targetExists(itemType, itemId))) return fail("That item could not be found.", 404);
    const existing = await prisma.researchThreadItem.findFirst({ where: { researchThreadId: threadId, itemType: itemType as ResearchThreadItemType, itemId } });
    if (existing) return NextResponse.json({ thread: await loadThread(threadId), alreadyPresent: true });
  }

  const last = await prisma.researchThreadItem.aggregate({ where: { researchThreadId: threadId }, _max: { orderIndex: true } });
  await prisma.$transaction([
    prisma.researchThreadItem.create({ data: { researchThreadId: threadId, itemType: itemType as ResearchThreadItemType, itemId, note, orderIndex: (last._max.orderIndex ?? -1) + 1 } }),
    prisma.researchThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } })
  ]);
  return NextResponse.json({ thread: await loadThread(threadId), alreadyPresent: false }, { status: 201 });
}

// Edit one item's note, or reorder the whole thread by passing `order`
// (a list of item ids, first to last).
export async function PATCH(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return fail("A JSON request body is required.");
  const threadId = text(body.threadId);
  if (!threadId) return fail("threadId is required.");

  if (Array.isArray(body.order)) {
    const order = body.order.map((value) => text(value)).filter(Boolean);
    const items = await prisma.researchThreadItem.findMany({ where: { researchThreadId: threadId }, select: { id: true } });
    const known = new Set(items.map((item) => item.id));
    if (order.length !== known.size || !order.every((id) => known.has(id)) || new Set(order).size !== order.length) return fail("order must list every item of the thread exactly once.");
    await prisma.$transaction(order.map((id, index) => prisma.researchThreadItem.update({ where: { id }, data: { orderIndex: index } })));
  } else {
    const itemId = text(body.itemId);
    if (!itemId || typeof body.note !== "string") return fail("itemId and note are required.");
    const item = await prisma.researchThreadItem.findFirst({ where: { id: itemId, researchThreadId: threadId } });
    if (!item) return fail("Thread item not found.", 404);
    await prisma.researchThreadItem.update({ where: { id: itemId }, data: { note: text(body.note) || null } });
  }
  await prisma.researchThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
  return NextResponse.json({ thread: await loadThread(threadId) });
}

export async function DELETE(request: NextRequest) {
  const threadId = text(request.nextUrl.searchParams.get("threadId"));
  const itemId = text(request.nextUrl.searchParams.get("itemId"));
  if (!threadId || !itemId) return fail("threadId and itemId are required.");
  const item = await prisma.researchThreadItem.findFirst({ where: { id: itemId, researchThreadId: threadId } });
  if (!item) return fail("Thread item not found.", 404);
  await prisma.researchThreadItem.delete({ where: { id: itemId } });
  // Close the gap so orderIndex stays 0..n-1.
  const rest = await prisma.researchThreadItem.findMany({ where: { researchThreadId: threadId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
  await prisma.$transaction(rest.map((row, index) => prisma.researchThreadItem.update({ where: { id: row.id }, data: { orderIndex: index } })));
  return NextResponse.json({ thread: await loadThread(threadId) });
}
