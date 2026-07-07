import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SourceEditorInput = {
  sourceId?: string;
  title?: string;
  author?: string;
  place?: string;
  publisher?: string;
  year?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validYear(value: string) {
  return !value || /^\d{1,4}$/.test(value);
}

function cslJsonFor(input: Required<Pick<SourceEditorInput, "title">> & SourceEditorInput): Prisma.InputJsonObject {
  const numericYear = input.year ? Number(input.year) : undefined;
  const json = {
    type: "book",
    title: input.title,
    author: input.author ? [{ literal: input.author }] : undefined,
    publisher: input.publisher || undefined,
    "publisher-place": input.place || undefined,
    issued: input.year ? { "date-parts": [[Number.isFinite(numericYear) ? numericYear : input.year]] } : undefined
  };

  return JSON.parse(JSON.stringify(json)) as Prisma.InputJsonObject;
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as SourceEditorInput;
  const sourceId = clean(body.sourceId);
  const title = clean(body.title);
  const author = clean(body.author);
  const place = clean(body.place);
  const publisher = clean(body.publisher);
  const year = clean(body.year);

  if (!sourceId) {
    return NextResponse.json({ error: "sourceId is required." }, { status: 400 });
  }

  if (!title) {
    return NextResponse.json({ error: "A CSL source title is required." }, { status: 400 });
  }

  if (!validYear(year)) {
    return NextResponse.json({ error: "Year must be a 1-4 digit year." }, { status: 400 });
  }

  const source = await prisma.source.update({
    where: { id: sourceId },
    data: {
      shortTitle: title,
      cslJson: cslJsonFor({ title, author, place, publisher, year })
    }
  });

  return NextResponse.json({ source });
}
