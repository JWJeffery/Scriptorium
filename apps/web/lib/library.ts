import { createHash } from "node:crypto";
import { Prisma, type ItemWorkflowState } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError, conflict, decodeCursor, encodeCursor, notFound, z } from "./api-v1";
import { readStoredPdfFile, storedFileSize } from "./server-storage";

// The Library service: the server is the single authority for what is in the library, what state
// each item is in, which collections and tags it has, and how far the reader has got.
// In the Research Environment specification a Document is an "Item"; this keeps the existing table
// and ids, so every annotation, citation and thread keeps pointing at the same record.

export const STATES = ["read_later", "reading", "archived"] as const;
export type ItemState = (typeof STATES)[number];
const toEnum: Record<ItemState, ItemWorkflowState> = { read_later: "READ_LATER", reading: "READING", archived: "ARCHIVED" };
const fromEnum: Record<ItemWorkflowState, ItemState> = { READ_LATER: "read_later", READING: "reading", ARCHIVED: "archived" };

export const VIEWS = ["all", "read_later", "reading", "archived", "favorites", "recently_added", "recently_annotated", "missing_metadata", "deleted"] as const;
const READABLE_KINDS = ["PDF", "TXT", "MARKDOWN", "DOCX"] as const;

const tagValue = z.string().trim().min(1).max(128).transform((value) => value.toLowerCase());

// The filters a list (or a saved search) can carry.
export const filterSchema = z.object({
  view: z.enum(VIEWS).default("all"),
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(128).optional(),
  collectionId: z.string().trim().max(191).optional(),
  favorite: z.enum(["true", "false"]).optional()
});
export type ItemFilters = z.infer<typeof filterSchema>;

export const listQuerySchema = filterSchema.extend({
  savedSearchId: z.string().trim().max(191).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const updateItemSchema = z
  .object({
    state: z.enum(STATES).optional(),
    favorite: z.boolean().optional(),
    title: z.string().trim().min(1).max(512).optional(),
    tags: z.array(tagValue).max(50).optional(),
    baseVersion: z.string().max(20).optional()
  })
  .strict();

export const progressSchema = z.object({ page: z.number().int().min(1).max(1_000_000), pageCount: z.number().int().min(1).max(1_000_000).optional() }).strict();

const itemInclude = {
  tags: { orderBy: { value: "asc" as const } },
  collections: { include: { collection: { select: { id: true, name: true } } } },
  _count: { select: { annotations: true } },
  sources: { orderBy: { createdAt: "asc" as const }, take: 1 },
  versions: { orderBy: { createdAt: "desc" as const }, take: 1, include: { _count: { select: { textSpans: true } } } }
} satisfies Prisma.DocumentInclude;
type ItemRow = Prisma.DocumentGetPayload<{ include: typeof itemInclude }>;

function primaryContributor(cslJson: unknown) {
  const authors = (cslJson as { author?: Array<{ family?: string; given?: string; literal?: string }> } | null)?.author;
  const first = Array.isArray(authors) ? authors[0] : undefined;
  if (!first) return null;
  return first.literal ?? ([first.family, first.given].filter(Boolean).join(", ") || null);
}

async function summarize(row: ItemRow) {
  const version = row.versions[0];
  const source = row.sources[0];
  const pageCount = row.pageCount ?? (version?._count.textSpans || null);
  const size = row.storageKey ? await storedFileSize(row.storageKey) : null;
  return {
    id: row.id,
    version: String(row.revision),
    title: row.title,
    kind: row.kind,
    filename: row.originalFilename,
    mediaType: row.mediaType,
    contributor: primaryContributor(source?.cslJson),
    state: fromEnum[row.workflowState],
    favorite: row.favorite,
    tags: row.tags.map((tag) => tag.value),
    collections: row.collections.map((entry) => entry.collection),
    annotationCount: row._count.annotations,
    progress: { lastPage: row.lastPage, pageCount, percent: row.lastPage && pageCount ? Math.min(100, Math.round((row.lastPage / pageCount) * 100)) : 0 },
    preservation: {
      originalStored: Boolean(row.storageKey) && size !== null,
      originalMissing: Boolean(row.storageKey) && size === null,
      sizeBytes: size,
      extraction: version?.extractionState ?? null,
      checksum: version?.sourceChecksum ?? null,
      versionCount: row.versions.length
    },
    acceptedAt: row.acceptedAt,
    lastOpenedAt: row.lastOpenedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt
  };
}

// ---------------------------------------------------------------- items

async function missingMetadataIds() {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT d.id FROM "Document" d
    WHERE NOT EXISTS (
      SELECT 1 FROM "Source" s
      WHERE s."documentId" = d.id
        AND jsonb_typeof(s."cslJson"->'author') = 'array'
        AND jsonb_array_length(s."cslJson"->'author') > 0
    )`;
  return rows.map((row) => row.id);
}

async function buildWhere(filters: ItemFilters): Promise<Prisma.DocumentWhereInput> {
  const and: Prisma.DocumentWhereInput[] = [
    { kind: { in: [...READABLE_KINDS] } },
    filters.view === "deleted" ? { deletedAt: { not: null } } : { deletedAt: null }
  ];
  if (filters.view === "read_later" || filters.view === "reading" || filters.view === "archived") and.push({ workflowState: toEnum[filters.view] });
  if (filters.view === "favorites" || filters.favorite === "true") and.push({ favorite: true });
  if (filters.favorite === "false") and.push({ favorite: false });
  if (filters.view === "missing_metadata") and.push({ id: { in: await missingMetadataIds() } });
  if (filters.tag) and.push({ tags: { some: { value: { equals: filters.tag, mode: "insensitive" } } } });
  if (filters.collectionId) and.push({ collections: { some: { collectionId: filters.collectionId } } });
  if (filters.q) {
    const contains = { contains: filters.q, mode: "insensitive" as const };
    and.push({ OR: [{ title: contains }, { originalFilename: contains }, { tags: { some: { value: contains } } }, { sources: { some: { shortTitle: contains } } }] });
  }
  return { AND: and };
}

export async function listItems(input: z.infer<typeof listQuerySchema>) {
  let filters: ItemFilters = { view: input.view, q: input.q, tag: input.tag, collectionId: input.collectionId, favorite: input.favorite };
  if (input.savedSearchId) {
    const saved = await prisma.savedSearch.findUnique({ where: { id: input.savedSearchId } });
    if (!saved) throw notFound("That saved search");
    const stored = filterSchema.safeParse(saved.query);
    if (stored.success) filters = { ...stored.data, ...Object.fromEntries(Object.entries(filters).filter(([key, value]) => value !== undefined && !(key === "view" && value === "all"))) } as ItemFilters;
  }
  const where = await buildWhere(filters);
  const limit = input.limit;

  if (filters.view === "recently_annotated") {
    const offset = decodeCursor(input.cursor, z.object({ o: z.number().int().min(0) }))?.o ?? 0;
    const matching = new Set((await prisma.document.findMany({ where, select: { id: true } })).map((row) => row.id));
    const grouped = await prisma.annotation.groupBy({ by: ["documentId"], _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } } });
    const ids = grouped.map((row) => row.documentId).filter((id) => matching.has(id));
    const pageIds = ids.slice(offset, offset + limit);
    const rows = await prisma.document.findMany({ where: { id: { in: pageIds } }, include: itemInclude });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = await Promise.all(pageIds.flatMap((id) => (byId.get(id) ? [summarize(byId.get(id) as ItemRow)] : [])));
    return { items, nextCursor: offset + limit < ids.length ? encodeCursor({ o: offset + limit }) : null, total: ids.length };
  }

  const cursor = decodeCursor(input.cursor, z.object({ id: z.string().max(191) }));
  const orderBy: Prisma.DocumentOrderByWithRelationInput[] = filters.view === "recently_added" ? [{ acceptedAt: "desc" }, { id: "desc" }] : [{ updatedAt: "desc" }, { id: "desc" }];
  const [rows, total] = await Promise.all([
    prisma.document.findMany({ where, orderBy, take: limit + 1, ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}), include: itemInclude }),
    prisma.document.count({ where })
  ]);
  const page = rows.slice(0, limit);
  return { items: await Promise.all(page.map(summarize)), nextCursor: rows.length > limit ? encodeCursor({ id: page[page.length - 1].id }) : null, total };
}

export async function getItem(id: string) {
  const row = await prisma.document.findUnique({ where: { id }, include: itemInclude });
  if (!row) throw notFound();
  const versions = await prisma.documentVersion.findMany({
    where: { documentId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, snapshotKind: true, snapshotKey: true, sourceChecksum: true, extractionState: true, createdAt: true, _count: { select: { textSpans: true, annotations: true } } }
  });
  return { ...(await summarize(row)), versions: versions.map((version) => ({ id: version.id, snapshotKind: version.snapshotKind, checksum: version.sourceChecksum, extraction: version.extractionState, createdAt: version.createdAt, segments: version._count.textSpans, annotations: version._count.annotations })), cslJson: row.sources[0]?.cslJson ?? null };
}

export async function updateItem(id: string, patch: z.infer<typeof updateItemSchema>) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.document.findUnique({ where: { id }, select: { revision: true, deletedAt: true } });
    if (!current || current.deletedAt) throw notFound();
    if (patch.baseVersion !== undefined && patch.baseVersion !== String(current.revision)) {
      throw conflict("This item was changed somewhere else since you loaded it. Reload and try again.", { currentVersion: String(current.revision) });
    }
    await tx.document.update({
      where: { id },
      data: {
        revision: { increment: 1 },
        ...(patch.state ? { workflowState: toEnum[patch.state] } : {}),
        ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
        ...(patch.title ? { title: patch.title } : {})
      }
    });
    if (patch.tags) {
      const unique = Array.from(new Set(patch.tags));
      await tx.documentTag.deleteMany({ where: { documentId: id } });
      if (unique.length) await tx.documentTag.createMany({ data: unique.map((value) => ({ documentId: id, value })) });
    }
  });
  const row = await prisma.document.findUniqueOrThrow({ where: { id }, include: itemInclude });
  return summarize(row);
}

// Reading position, kept on the server so every browser agrees. The first time a book is opened
// it moves from "Read later" to "Reading"; it never moves back on its own.
export async function recordProgress(id: string, input: z.infer<typeof progressSchema>) {
  const found = await prisma.document.updateMany({
    where: { id, deletedAt: null },
    data: { lastPage: input.page, lastOpenedAt: new Date(), ...(input.pageCount ? { pageCount: input.pageCount } : {}) }
  });
  if (found.count === 0) throw notFound();
  await prisma.document.updateMany({ where: { id, workflowState: "READ_LATER" }, data: { workflowState: "READING" } });
  return { id, lastPage: input.page, pageCount: input.pageCount ?? null };
}

export async function deleteImpact(id: string) {
  const document = await prisma.document.findUnique({ where: { id }, select: { id: true, title: true, storageKey: true, deletedAt: true } });
  if (!document) throw notFound();
  const [annotations, citations, bookmarks, versions, threadReferences, collections] = await Promise.all([
    prisma.annotation.count({ where: { documentId: id } }),
    prisma.citation.count({ where: { annotation: { documentId: id } } }),
    prisma.bookmark.count({ where: { documentId: id } }),
    prisma.documentVersion.count({ where: { documentId: id } }),
    prisma.researchThreadItem.count({ where: { OR: [{ itemType: "DOCUMENT", itemId: id }, { itemType: "ANNOTATION", itemId: { in: (await prisma.annotation.findMany({ where: { documentId: id }, select: { id: true } })).map((row) => row.id) } }] } }),
    prisma.itemCollection.count({ where: { documentId: id } })
  ]);
  return { id, title: document.title, alreadyDeleted: Boolean(document.deletedAt), annotations, citations, bookmarks, versions, threadReferences, collections, files: document.storageKey ? 1 : 0 };
}

export async function softDeleteItem(id: string) {
  const result = await prisma.document.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
  if (result.count === 0) throw notFound();
  return { id, deleted: true, recoverableForDays: 30 };
}

export async function restoreItem(id: string) {
  const result = await prisma.document.updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null, revision: { increment: 1 } } });
  if (result.count === 0) throw notFound("That deleted item");
  return summarize(await prisma.document.findUniqueOrThrow({ where: { id }, include: itemInclude }));
}

// ---------------------------------------------------------------- collections

export const collectionSchema = z.object({ name: z.string().trim().min(1).max(255), description: z.string().trim().max(5000).optional() }).strict();
export const collectionPatchSchema = collectionSchema.partial().strict();
export const membershipSchema = z.object({ itemIds: z.array(z.string().max(191)).min(1).max(500) }).strict();

async function assertUniqueName(name: string, exceptId?: string) {
  const clash = await prisma.collection.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
  if (clash) throw conflict("A collection with that name already exists.");
}

export async function listCollections() {
  const rows = await prisma.collection.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } });
  return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, itemCount: row._count.items, createdAt: row.createdAt, updatedAt: row.updatedAt }));
}

export async function createCollection(input: z.infer<typeof collectionSchema>) {
  await assertUniqueName(input.name);
  const row = await prisma.collection.create({ data: { name: input.name, description: input.description ?? null } });
  return { id: row.id, name: row.name, description: row.description, itemCount: 0, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function updateCollection(id: string, input: z.infer<typeof collectionPatchSchema>) {
  if (input.name) await assertUniqueName(input.name, id);
  const exists = await prisma.collection.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound("That collection");
  const row = await prisma.collection.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) }, include: { _count: { select: { items: true } } } });
  return { id: row.id, name: row.name, description: row.description, itemCount: row._count.items, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

// Deleting a collection only removes the grouping; the items stay in the library.
export async function deleteCollection(id: string) {
  const exists = await prisma.collection.findUnique({ where: { id }, select: { id: true, _count: { select: { items: true } } } });
  if (!exists) throw notFound("That collection");
  await prisma.collection.delete({ where: { id } });
  return { id, deleted: true, itemsKept: exists._count.items };
}

export async function addToCollection(collectionId: string, itemIds: string[]) {
  const collection = await prisma.collection.findUnique({ where: { id: collectionId }, select: { id: true } });
  if (!collection) throw notFound("That collection");
  const unique = Array.from(new Set(itemIds));
  const existing = await prisma.document.findMany({ where: { id: { in: unique }, deletedAt: null }, select: { id: true } });
  const existingIds = new Set(existing.map((row) => row.id));
  const already = new Set((await prisma.itemCollection.findMany({ where: { collectionId, documentId: { in: unique } }, select: { documentId: true } })).map((row) => row.documentId));
  const toAdd = unique.filter((id) => existingIds.has(id) && !already.has(id));
  const last = await prisma.itemCollection.aggregate({ where: { collectionId }, _max: { position: true } });
  let position = (last._max.position ?? 0) + 1;
  if (toAdd.length) await prisma.itemCollection.createMany({ data: toAdd.map((documentId) => ({ collectionId, documentId, position: position++ })), skipDuplicates: true });
  return { added: toAdd.length, alreadyMembers: already.size, missing: unique.filter((id) => !existingIds.has(id)) };
}

export async function removeFromCollection(collectionId: string, itemIds: string[]) {
  const collection = await prisma.collection.findUnique({ where: { id: collectionId }, select: { id: true } });
  if (!collection) throw notFound("That collection");
  const result = await prisma.itemCollection.deleteMany({ where: { collectionId, documentId: { in: itemIds } } });
  return { removed: result.count };
}

// ---------------------------------------------------------------- saved searches

export const savedSearchSchema = z.object({ name: z.string().trim().min(1).max(255), query: filterSchema, sort: z.string().trim().max(64).optional() }).strict();

export async function listSavedSearches() {
  const rows = await prisma.savedSearch.findMany({ orderBy: { name: "asc" } });
  return rows.map((row) => ({ id: row.id, name: row.name, query: row.query, sort: row.sort, createdAt: row.createdAt }));
}

export async function createSavedSearch(input: z.infer<typeof savedSearchSchema>) {
  const row = await prisma.savedSearch.create({ data: { name: input.name, query: input.query as Prisma.InputJsonObject, sort: input.sort ?? "recent" } });
  return { id: row.id, name: row.name, query: row.query, sort: row.sort, createdAt: row.createdAt };
}

export async function deleteSavedSearch(id: string) {
  const result = await prisma.savedSearch.deleteMany({ where: { id } });
  if (result.count === 0) throw notFound("That saved search");
  return { id, deleted: true };
}

// ---------------------------------------------------------------- duplicates

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function findItemByChecksum(checksum: string) {
  const version = await prisma.documentVersion.findFirst({
    where: { sourceChecksum: checksum, document: { deletedAt: null } },
    select: { document: { select: { id: true, title: true } } }
  });
  return version?.document ?? null;
}

// Books uploaded before checksums were recorded get one now, so duplicates can be found.
export async function backfillChecksums() {
  const versions = await prisma.documentVersion.findMany({
    where: { sourceChecksum: null, snapshotKey: { not: null }, document: { kind: "PDF" } },
    select: { id: true, snapshotKey: true }
  });
  let updated = 0;
  let missingFile = 0;
  for (const version of versions) {
    try {
      const bytes = await readStoredPdfFile(version.snapshotKey as string);
      await prisma.documentVersion.update({ where: { id: version.id }, data: { sourceChecksum: sha256Hex(bytes) } });
      updated += 1;
    } catch {
      missingFile += 1;
    }
  }
  return { checked: versions.length, updated, missingFile };
}

export async function duplicateGroups() {
  const rows = await prisma.$queryRaw<Array<{ checksum: string; ids: string[] }>>`
    SELECT v."sourceChecksum" AS checksum, array_agg(DISTINCT d.id) AS ids
    FROM "DocumentVersion" v JOIN "Document" d ON d.id = v."documentId"
    WHERE v."sourceChecksum" IS NOT NULL AND d."deletedAt" IS NULL
    GROUP BY v."sourceChecksum" HAVING COUNT(DISTINCT d.id) > 1`;
  const titles = await prisma.document.findMany({ where: { id: { in: rows.flatMap((row) => row.ids) } }, select: { id: true, title: true } });
  const titleById = new Map(titles.map((row) => [row.id, row.title]));
  return rows.map((row) => ({ checksum: row.checksum, items: row.ids.map((id) => ({ id, title: titleById.get(id) ?? id })) }));
}

export { ApiError };
