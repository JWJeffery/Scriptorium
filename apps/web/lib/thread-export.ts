type ThreadTag = { value: string };
type ThreadItem = {
  itemType: string;
  itemId: string;
  note?: string | null;
  orderIndex: number;
  context?: unknown;
};

type ThreadExportRecord = {
  title: string;
  description?: string | null;
  tags?: ThreadTag[];
  items: ThreadItem[];
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? value as JsonRecord : {};
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeMarkdown(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function escapeRtf(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\par ");
}

function citationText(context: JsonRecord) {
  return clean(context.generatedText) || clean(asRecord(context.citations)?.generatedText);
}

function sourceTitle(context: JsonRecord) {
  return clean(context.shortTitle) || clean(asRecord(context.source).shortTitle) || clean(asRecord(context.document).title);
}

function documentTitle(context: JsonRecord) {
  return clean(context.title) || clean(asRecord(context.document).title);
}

function locatorText(context: JsonRecord) {
  const pageMap = asRecord(context.pageMap);
  const citation = asRecord(context.citation);
  const directLocator = clean(context.locatorValue) || clean(citation.locatorValue);
  const directType = clean(context.locatorType) || clean(citation.locatorType);
  const pageLabel = clean(pageMap.bookPageLabel) || clean(pageMap.visibleLabel);

  if (directLocator && directType) return `${directType} ${directLocator}`;
  if (directLocator) return directLocator;
  if (pageLabel) return `page ${pageLabel}`;
  return "";
}

function annotationSummary(context: JsonRecord) {
  const selectedText = clean(context.selectedText);
  const note = clean(context.note);
  const document = documentTitle(context);
  const locator = locatorText(context);
  const citation = Array.isArray(context.citations) ? citationText(asRecord(context.citations[0])) : "";
  return [
    document ? `Source: ${document}` : "",
    locator ? `Locator: ${locator}` : "",
    selectedText ? `Passage: ${selectedText}` : "",
    note ? `Annotation note: ${note}` : "",
    citation ? `Citation: ${citation}` : ""
  ].filter(Boolean);
}

function citationSummary(context: JsonRecord) {
  const citation = clean(context.generatedText);
  const source = sourceTitle(context);
  const locator = locatorText(context);
  return [
    citation ? `Citation: ${citation}` : "",
    source ? `Source: ${source}` : "",
    locator ? `Locator: ${locator}` : ""
  ].filter(Boolean);
}

function sourceSummary(context: JsonRecord) {
  const source = sourceTitle(context);
  const document = documentTitle(context);
  return [
    source ? `Source: ${source}` : "",
    document ? `Document: ${document}` : ""
  ].filter(Boolean);
}

function documentSummary(context: JsonRecord) {
  const title = documentTitle(context);
  const kind = clean(context.kind);
  const filename = clean(context.originalFilename);
  return [
    title ? `Document: ${title}` : "",
    kind ? `Kind: ${kind}` : "",
    filename ? `File: ${filename}` : ""
  ].filter(Boolean);
}

function itemLines(item: ThreadItem) {
  const context = asRecord(item.context);
  const note = clean(item.note);
  const lines =
    item.itemType === "ANNOTATION" ? annotationSummary(context) :
    item.itemType === "CITATION" ? citationSummary(context) :
    item.itemType === "SOURCE" ? sourceSummary(context) :
    item.itemType === "DOCUMENT" ? documentSummary(context) :
    [];

  if (note) lines.push(`Thread note: ${note}`);
  if (item.itemType === "NOTE" && note) return [`Note: ${note}`];
  if (!lines.length) lines.push(`Reference: ${item.itemType} ${item.itemId}`);
  return lines;
}

export function exportThreadMarkdown(thread: ThreadExportRecord) {
  const tags = thread.tags?.map((tag) => tag.value).filter(Boolean) ?? [];
  const lines = [`# ${escapeMarkdown(thread.title)}`, ""];

  if (thread.description) {
    lines.push(escapeMarkdown(thread.description), "");
  }

  if (tags.length) {
    lines.push(`Tags: ${tags.map((tag) => `#${tag}`).join(" ")}`, "");
  }

  lines.push("## Thread items", "");

  for (const item of thread.items) {
    lines.push(`${item.orderIndex + 1}. **${item.itemType}**`);
    for (const line of itemLines(item)) {
      lines.push(`   - ${escapeMarkdown(line)}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function exportThreadRtf(thread: ThreadExportRecord) {
  const markdown = exportThreadMarkdown(thread);
  const body = markdown.split("\n").map((line) => escapeRtf(line)).join("\\par ");
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\fs24 ${body}}`;
}

export function exportResearchThread(thread: ThreadExportRecord, format: "markdown" | "rtf") {
  return format === "markdown" ? exportThreadMarkdown(thread) : exportThreadRtf(thread);
}
