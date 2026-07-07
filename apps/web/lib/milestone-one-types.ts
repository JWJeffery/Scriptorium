export type MilestoneOneSourceInput = {
  author?: string;
  title: string;
  place?: string;
  publisher?: string;
  year?: string;
};

export type MilestoneOnePageMapInput = {
  basePdfPageIndex: number;
  baseBookPage: number;
  currentPdfPageIndex: number;
  bookPageLabel: string;
};

export type MilestoneOneDocumentInput = {
  title: string;
  filename: string;
  mediaType: string;
  size: number;
  source: MilestoneOneSourceInput;
  pageMap: MilestoneOnePageMapInput;
};

export type MilestoneOneAnchorInput = {
  selectedText: string;
  pageNumber: number;
  beforeContext?: string;
  afterContext?: string;
  rects?: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
  startOffset?: number;
  endOffset?: number;
  lineStart?: number;
  lineEnd?: number;
  locatorKind?: "page" | "line";
};

export type MilestoneOneAnnotationInput = {
  documentId: string;
  versionId: string;
  sourceId: string;
  pageMapId?: string;
  colorKey: string;
  selectedText: string;
  note?: string;
  tags?: string[];
  anchor?: MilestoneOneAnchorInput;
  citationStyle: string;
  citationText: string;
  locatorType?: string;
  locatorValue?: string;
};
