// Types and helpers for the Library screens (browser side). The shapes match /api/v1/items.

export type ItemState = "read_later" | "reading" | "archived";

export type ItemSummary = {
  id: string;
  version: string;
  title: string;
  kind: string;
  filename: string | null;
  mediaType: string | null;
  contributor: string | null;
  state: ItemState;
  favorite: boolean;
  tags: string[];
  collections: Array<{ id: string; name: string }>;
  annotationCount: number;
  progress: { lastPage: number | null; pageCount: number | null; percent: number };
  preservation: { originalStored: boolean; originalMissing: boolean; sizeBytes: number | null; extraction: string | null; checksum: string | null; versionCount: number };
  acceptedAt: string;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ItemDetail = ItemSummary & {
  versions: Array<{ id: string; snapshotKind: string; checksum: string | null; extraction: string; createdAt: string; segments: number; annotations: number }>;
  cslJson: Record<string, unknown> | null;
};

export type CollectionSummary = { id: string; name: string; description: string | null; itemCount: number };
export type SavedSearchSummary = { id: string; name: string; query: Record<string, string | undefined>; sort: string };
export type DeleteImpact = { id: string; title: string; annotations: number; citations: number; bookmarks: number; versions: number; threadReferences: number; collections: number; files: number };
export type JobSummary = {
  id: string; type: string; subjectId: string; state: "queued" | "running" | "complete" | "failed";
  progress: { done: number; total: number } | null; attempts: number; error: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; itemId: string | null; itemTitle: string | null;
};

export const STATE_LABEL: Record<ItemState, string> = { read_later: "Read later", reading: "Reading", archived: "Archived" };

export const VIEWS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "read_later", label: "Read later" },
  { key: "reading", label: "Reading" },
  { key: "archived", label: "Archived" },
  { key: "favorites", label: "Favorites" },
  { key: "recently_added", label: "Recently added" },
  { key: "recently_annotated", label: "Recently annotated" },
  { key: "missing_metadata", label: "Missing metadata" },
  { key: "deleted", label: "Deleted" }
];

export const JOB_LABEL: Record<string, string> = { ocr: "Read scanned text (OCR)", "page-split": "Split two-page spreads", "embed-index": "Build the by-meaning index" };

export class ApiProblem extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string, public readonly body: Record<string, unknown>) {
    super(message);
  }
}

// Calls the API and returns its JSON, or throws an ApiProblem carrying the server's own message.
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {})
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiProblem(typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : `The server answered ${response.status}.`, response.status, typeof body.code === "string" ? body.code : "error", body);
  return body as T;
}

export function sizeLabel(bytes: number | null) {
  if (bytes === null) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function dateLabel(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function readerLink(id: string) {
  return `/?open=${encodeURIComponent(id)}`;
}
