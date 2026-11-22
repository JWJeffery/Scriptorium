// What the browser keeps of highlights. It keeps a copy so the page opens at once and works through a brief outage,
// but the database is the truth, and browser storage holds only about 5 MB. So the copy is limited to the open
// book's highlights plus anything the database has not received yet (other books' highlights are reloaded when
// they are opened), and running out of storage never throws: unsent work is kept first.

type Kept = { documentId: string; versionId?: string; serverAnnotationId?: string; pendingEdit?: boolean };
type OpenBook = { id: string; server?: { documentId: string; versionId: string } } | null;
type StorageLike = { setItem(key: string, value: string): void };

export function annotationsWorthKeeping<T extends Kept>(records: T[], current: OpenBook): T[] {
  const ids = new Set([current?.id, current?.server?.documentId].filter(Boolean) as string[]);
  return records.filter((record) => !record.serverAnnotationId || record.pendingEdit || ids.has(record.documentId) || (record.versionId !== undefined && record.versionId === current?.server?.versionId));
}

export function writeAnnotationCopy<T extends Kept>(storage: StorageLike, key: string, records: T[], current: OpenBook) {
  const attempts = [annotationsWorthKeeping(records, current), records.filter((record) => !record.serverAnnotationId || record.pendingEdit)];
  for (const attempt of attempts) {
    try { storage.setItem(key, JSON.stringify(attempt)); return true; } catch { /* full or blocked: try a smaller copy */ }
  }
  console.warn("[storage] this browser's storage is full; highlights are safe in the database but the offline copy could not be updated.");
  return false;
}
