// In-memory only, same reasoning as OCR's progress map in
// milestone-sixteen/ocr-status - lost on server restart, which is fine
// here: a split result is an intermediate, reviewable artifact (see
// pdf-page-splitter.ts's own top-of-file note on why this was
// deliberately never wired to silently replace a document's working
// PDF), not something that needs to survive one. The person reviews the
// split, and only their explicit "create as new document" click (via the
// existing upload flow, same as re-uploading the CLI tool's output file)
// persists anything durable.
//
// Lives in its own module, not in route.ts, because Next.js App Router
// route files may only export the handful of recognized handlers (GET,
// POST, etc.) and a few config values - any other export is a build
// error. The download route needs access to the same map the main route
// writes to, so it has to live somewhere both can import from.
export type SplitJobState = {
  status: "running" | "ready" | "failed";
  progress: { completed: number; total: number } | null;
  error?: string;
  resultStorageKey?: string;
  originalPageCount?: number;
  newPageCount?: number;
  splitOriginalPageNumbers?: number[];
};

export const splitJobs = new Map<string, SplitJobState>();
