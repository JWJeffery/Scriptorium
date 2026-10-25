import { AlignmentType, Document, FootnoteReferenceRun, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ThreadView } from "./thread-context";
import { decodeEntities, formatBibliography, formatCitations, isStyleKey, styleKind, type CitationStyleKey, type CiteInput, type FormattedCitation } from "./csl-engine.ts";

// Turns a research thread into a document a person can write from: the quoted
// passages and notes in the order they chose, with each citation as a real
// footnote (titles in italics, repeat references shortened by the citation style)
// and a bibliography of the sources used. The same structure feeds the Markdown
// and Word writers.

export type DocumentBlock =
  | { kind: "quote"; text: string; citation: CiteSpec | null }
  | { kind: "paragraph"; text: string }
  | { kind: "annotation-note"; text: string }
  | { kind: "reference"; text: string; citation: CiteSpec | null };

/** What is needed to cite something: the stored wording, plus the source so a style can re-format it. */
export type CiteSpec = { stored: string; sourceKey: string | null; csl: unknown; locator: string | null; label: string };

export type ThreadDocument = { title: string; description: string; tags: string[]; blocks: DocumentBlock[]; missing: number };

export function buildThreadDocument(thread: ThreadView): ThreadDocument {
  const blocks: DocumentBlock[] = [];
  let missing = 0;
  for (const item of thread.items) {
    const context = item.context;
    if (context === null) { missing += 1; continue; }
    if (context.itemType === "NOTE") {
      if (item.note) blocks.push({ kind: "paragraph", text: item.note });
    } else if (context.itemType === "ANNOTATION") {
      if (context.selectedText.trim()) {
        const citation: CiteSpec | null = context.citationText || context.sourceCsl
          ? { stored: context.citationText, sourceKey: context.sourceId, csl: context.sourceCsl, locator: context.locatorValue, label: context.locatorType === "line" ? "line" : "page" }
          : null;
        blocks.push({ kind: "quote", text: context.selectedText.trim(), citation });
      }
      if (context.note.trim()) blocks.push({ kind: "annotation-note", text: context.note.trim() });
      if (item.note) blocks.push({ kind: "paragraph", text: item.note });
    } else if (context.itemType === "CITATION") {
      blocks.push({ kind: "reference", text: item.note || "", citation: { stored: context.citationText, sourceKey: null, csl: null, locator: null, label: "page" } });
    } else if (context.itemType === "SOURCE") {
      blocks.push({ kind: "reference", text: item.note || context.title, citation: { stored: context.citationText, sourceKey: null, csl: null, locator: null, label: "page" } });
    } else if (context.itemType === "DOCUMENT") {
      blocks.push({ kind: "paragraph", text: `${context.documentTitle}${item.note ? ` — ${item.note}` : ""}` });
    }
  }
  return { title: thread.title, description: thread.description, tags: thread.tags, blocks, missing };
}

const cites = (doc: ThreadDocument) => doc.blocks.flatMap((block) => ((block.kind === "quote" || block.kind === "reference") && block.citation ? [block.citation] : []));

export type RenderedNotes = { notes: FormattedCitation[]; bibliography: FormattedCitation[]; style: CitationStyleKey; formatted: boolean };

/**
 * Footnote text for every citation, in document order. Where the source is known
 * the chosen style formats it (first mention in full, later mentions shortened);
 * otherwise the wording stored when the passage was saved is used as it is.
 */
export function renderNotes(doc: ThreadDocument, styleName: string = "sbl-note"): RenderedNotes {
  const style: CitationStyleKey = isStyleKey(styleName) && styleKind(styleName) === "note" ? styleName : "sbl-note";
  const specs = cites(doc);
  const known = specs.filter((spec) => spec.csl && spec.sourceKey);
  let formatted: FormattedCitation[] = [];
  if (known.length === specs.length && specs.length > 0) {
    try {
      const inputs: CiteInput[] = specs.map((spec) => ({ key: spec.sourceKey as string, csl: spec.csl, locator: spec.locator ?? undefined, label: spec.label }));
      formatted = formatCitations(style, inputs, "sequence");
    } catch { formatted = []; }
  }
  const usedFormatter = formatted.length === specs.length && specs.length > 0;
  const notes = usedFormatter ? formatted : specs.map((spec) => ({ text: spec.stored, html: escapeHtml(spec.stored) }));

  let bibliography: FormattedCitation[] = [];
  if (usedFormatter) {
    const seen = new Set<string>();
    const sources = known.flatMap((spec) => (seen.has(spec.sourceKey as string) ? [] : (seen.add(spec.sourceKey as string), [{ key: spec.sourceKey as string, csl: spec.csl }])));
    try { bibliography = formatBibliography(style, sources); } catch { bibliography = []; }
  }
  return { notes, bibliography, style, formatted: usedFormatter };
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Split engine HTML into runs, honouring <i> and <b>; everything else is plain text. */
export function htmlRuns(html: string): Array<{ text: string; italics: boolean; bold: boolean }> {
  const runs: Array<{ text: string; italics: boolean; bold: boolean }> = [];
  let italics = false;
  let bold = false;
  for (const part of html.split(/(<\/?(?:i|em|b|strong)>)/i)) {
    const tag = /^<(\/?)(i|em|b|strong)>$/i.exec(part);
    if (tag) {
      const on = tag[1] === "";
      if (/^(i|em)$/i.test(tag[2])) italics = on; else bold = on;
      continue;
    }
    const text = decodeEntities(part.replace(/<[^>]+>/g, ""));
    if (text !== "") runs.push({ text, italics, bold });
  }
  return runs;
}

export function threadToMarkdown(doc: ThreadDocument, rendered: RenderedNotes = renderNotes(doc)): string {
  const md = (html: string) => html.replace(/<i>(.*?)<\/i>/g, "*$1*").replace(/<b>(.*?)<\/b>/g, "**$1**").replace(/<[^>]+>/g, "").replace(/&#38;|&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  let n = 0;
  const lines: string[] = [`# ${doc.title}`, ""];
  if (doc.description) lines.push(doc.description, "");
  if (doc.tags.length) lines.push(`*Tags: ${doc.tags.join(", ")}*`, "");
  for (const block of doc.blocks) {
    if (block.kind === "quote") {
      lines.push(...block.text.split("\n").map((line) => `> ${line}`));
      if (block.citation) { n += 1; lines[lines.length - 1] += `[^${n}]`; }
      lines.push("");
    } else if (block.kind === "annotation-note") {
      lines.push(`*Note:* ${block.text}`, "");
    } else if (block.kind === "reference") {
      if (block.citation) n += 1;
      lines.push(`${block.text}${block.citation ? `[^${n}]` : ""}`.trim(), "");
    } else {
      lines.push(block.text, "");
    }
  }
  if (rendered.notes.length) {
    lines.push("---", "");
    rendered.notes.forEach((note, index) => lines.push(`[^${index + 1}]: ${md(note.html)}`));
  }
  if (rendered.bibliography.length) {
    lines.push("", "## Bibliography", "");
    rendered.bibliography.forEach((entry) => lines.push(`- ${md(entry.html)}`));
  }
  if (doc.missing) lines.push("", `*${doc.missing} item${doc.missing === 1 ? "" : "s"} could not be exported because the original no longer exists.*`);
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function threadToDocx(doc: ThreadDocument, rendered: RenderedNotes = renderNotes(doc)): Promise<Buffer> {
  const runsOf = (html: string) => htmlRuns(html).map((run) => new TextRun({ text: run.text, italics: run.italics, bold: run.bold }));
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  rendered.notes.forEach((note, index) => {
    footnotes[index + 1] = { children: [new Paragraph({ children: runsOf(note.html) })] };
  });

  let n = 0;
  const children: Paragraph[] = [new Paragraph({ text: doc.title, heading: HeadingLevel.HEADING_1 })];
  if (doc.description) children.push(new Paragraph({ children: [new TextRun(doc.description)], spacing: { after: 200 } }));
  if (doc.tags.length) children.push(new Paragraph({ children: [new TextRun({ text: `Tags: ${doc.tags.join(", ")}`, italics: true })], spacing: { after: 200 } }));

  for (const block of doc.blocks) {
    if (block.kind === "quote") {
      const runs: Array<TextRun | FootnoteReferenceRun> = [new TextRun(block.text)];
      if (block.citation) { n += 1; runs.push(new FootnoteReferenceRun(n)); }
      children.push(new Paragraph({ children: runs, indent: { left: 720, right: 720 }, spacing: { after: 160 } }));
    } else if (block.kind === "annotation-note") {
      children.push(new Paragraph({ children: [new TextRun({ text: "Note: ", bold: true }), new TextRun({ text: block.text, italics: true })], spacing: { after: 160 } }));
    } else if (block.kind === "reference") {
      const runs: Array<TextRun | FootnoteReferenceRun> = [new TextRun(block.text)];
      if (block.citation) { n += 1; runs.push(new FootnoteReferenceRun(n)); }
      children.push(new Paragraph({ children: runs, spacing: { after: 160 } }));
    } else {
      children.push(new Paragraph({ children: [new TextRun(block.text)], spacing: { after: 160 }, alignment: AlignmentType.LEFT }));
    }
  }
  if (rendered.bibliography.length) {
    children.push(new Paragraph({ text: "Bibliography", heading: HeadingLevel.HEADING_2, spacing: { before: 360 } }));
    for (const entry of rendered.bibliography) {
      children.push(new Paragraph({ children: runsOf(entry.html), indent: { left: 720, hanging: 720 }, spacing: { after: 120 } }));
    }
  }
  if (doc.missing) {
    children.push(new Paragraph({ children: [new TextRun({ text: `${doc.missing} item${doc.missing === 1 ? "" : "s"} could not be exported because the original no longer exists.`, italics: true })] }));
  }

  const file = new Document({ creator: "Scriptorium", title: doc.title, footnotes, sections: [{ children }] });
  return await Packer.toBuffer(file);
}
