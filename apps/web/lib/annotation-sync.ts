// Keeps the browser's copy of a book's annotations in step with the database.
//
// The database is the truth. The browser keeps a copy so the page opens at once
// and keeps working when the server is briefly unreachable. After asking the
// database for a book's annotations, this decides what the browser should hold:
//   * whatever the database has replaces the browser's version of that record
//   * a record the browser has but the database no longer does was deleted
//     elsewhere, so it is dropped
//   * a record the database never received (saved while it was unreachable) is
//     kept, flagged as unsaved, so it can be sent again
//   * records of other books are left alone

export type SyncRecord = { id: string; documentId: string; versionId?: string; serverAnnotationId?: string; createdAt: string };

export type SyncScope = { versionIds: Set<string>; localDocumentIds: Set<string> };

export type SyncResult<T> = { records: T[]; added: number; updated: number; removed: number; unsaved: number };

export function belongsToScope(record: SyncRecord, scope: SyncScope) {
  return record.versionId ? scope.versionIds.has(record.versionId) : scope.localDocumentIds.has(record.documentId);
}

export function mergeServerRecords<T extends SyncRecord>(local: T[], fetched: T[], scope: SyncScope): SyncResult<T> {
  const fresh = new Map(fetched.map((record) => [record.serverAnnotationId as string, record]));
  const kept: T[] = [];
  let updated = 0;
  let removed = 0;
  let unsaved = 0;

  for (const record of local) {
    if (!belongsToScope(record, scope)) { kept.push(record); continue; }
    if (!record.serverAnnotationId) { kept.push(record); unsaved += 1; continue; }
    const server = fresh.get(record.serverAnnotationId);
    if (!server) { removed += 1; continue; }
    fresh.delete(record.serverAnnotationId);
    kept.push({ ...server, id: record.id });
    updated += 1;
  }

  const added = fresh.size;
  const records = [...fresh.values(), ...kept].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { records, added, updated, removed, unsaved };
}
