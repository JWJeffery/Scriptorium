// One book as the reader needs it to open it (from /api/core/library).
export type SavedDocumentEntry = {
  documentId: string;
  title: string;
  kind: "PDF" | "TXT" | "MARKDOWN" | "DOCX";
  filename: string;
  mediaType: string;
  size: number | null;
  storageKey: string | null;
  updatedAt: string;
  annotationCount: number;
  lastPage?: number | null;
  pageCount: number | null;
  fileMissing: boolean;
  versionId: string;
  snapshotKey: string | null;
  sourceChecksum: string | null;
  sourceId: string;
  cslJson: unknown;
  pageMapId: string;
  pdfPageIndex: number;
  pageMapNote: string | null;
  bookPageLabel: string | null;
};
