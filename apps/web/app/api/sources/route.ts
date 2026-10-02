import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { parseAuthors } from "../../../lib/author-names";

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
    author: input.author ? parseAuthors(input.author) : undefined,
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

  const existing = await prisma.source.findUnique({ where: { id: sourceId }, select: { cslJson: true } });
  if (!existing) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }
  // Update only the fields this form edits. The expanded source editor can also
  // hold editors, translators, containers, volumes and so on; replacing the whole
  // record here used to erase them.
  const previous = (typeof existing.cslJson === "object" && existing.cslJson !== null && !Array.isArray(existing.cslJson) ? existing.cslJson : {}) as Record<string, unknown>;
  const edited = cslJsonFor({ title, author, place, publisher, year }) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...previous, type: previous.type ?? edited.type, title: edited.title };
  for (const key of ["author", "publisher", "publisher-place", "issued"]) {
    if (edited[key] === undefined) delete merged[key];
    else merged[key] = edited[key];
  }

  const source = await prisma.source.update({
    where: { id: sourceId },
    data: {
      shortTitle: title,
      cslJson: JSON.parse(JSON.stringify(merged)) as Prisma.InputJsonObject
    }
  });

  return NextResponse.json({ source });
}
