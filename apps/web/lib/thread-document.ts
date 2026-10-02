import { AlignmentType, Document, FootnoteReferenceRun, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ThreadView } from "./thread-context";

// Turns a research thread into a document a person can write from: the quoted
// passages and notes in the order they chose, with each citation as a real
// footnote. The same neutral structure feeds the Markdown and Word writers.

export type DocumentBlock =
  | { kind: "quote"; text: string; citation: string; locator: string }
  | { kind: "paragraph"; text: string }
  | { kind: "annotation-note"; text: string }
  | { kind: "reference"; text: string; citation: string };

export type ThreadDocument = { title: string; description: string; tags: string[]; blocks: DocumentBlock[]; missing: number };

// The citation shown in the footnote for the nth citation. A formatter that
// knows about earlier notes (shortened repeat references) can replace this.
export type CitationFormatter = (citations: string[]) => string[];

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
        blocks.push({ kind: "quote", text: context.selectedText.trim(), citation: context.citationText, locator: context.bookPage ? `p. ${context.bookPage}` : "" });
      }
      if (context.note.trim()) blocks.push({ kind: "annotation-note", text: context.note.trim() });
      if (item.note) blocks.push({ kind: "paragraph", text: item.note });
    } else if (context.itemType === "CITATION") {
      blocks.push({ kind: "reference", text: item.note || "", citation: context.citationText });
    } else if (context.itemType === "SOURCE") {
      blocks.push({ kind: "reference", text: item.note || context.title, citation: context.citationText });
    } else if (context.itemType === "DOCUMENT") {
      blocks.push({ kind: "paragraph", text: `${context.documentTitle}${item.note ? ` — ${item.note}` : ""}` });
    }
  }
  return { title: thread.title, description: thread.description, tags: thread.tags, blocks, missing };
}

function citationsOf(doc: ThreadDocument) {
  return doc.blocks.flatMap((block) => (block.kind === "quote" || block.kind === "reference") && block.citation ? [block.citation] : []);
}

export function threadToMarkdown(doc: ThreadDocument, format: CitationFormatter = (c) => c): string {
  const notes = format(citationsOf(doc));
  let n = 0;
  const lines: string[] = [`# ${doc.title}`, ""];
  if (doc.description) lines.push(doc.description, "");
  if (doc.tags.length) lines.push(`*Tags: ${doc.tags.join(", ")}*`, "");
  for (const block of doc.blocks) {
    if (block.kind === "quote") {
      n += block.citation ? 1 : 0;
      lines.push(...block.text.split("\n").map((line) => `> ${line}`));
      if (block.citation) lines[lines.length - 1] += `[^${n}]`;
      lines.push("");
    } else if (block.kind === "annotation-note") {
      lines.push(`*Note:* ${block.text}`, "");
    } else if (block.kind === "reference") {
      n += block.citation ? 1 : 0;
      lines.push(`${block.text}${block.citation ? `[^${n}]` : ""}`.trim(), "");
    } else {
      lines.push(block.text, "");
    }
  }
  if (notes.length) {
    lines.push("---", "");
    notes.forEach((note, index) => lines.push(`[^${index + 1}]: ${note}`));
  }
  if (doc.missing) lines.push("", `*${doc.missing} item${doc.missing === 1 ? "" : "s"} could not be exported because the original no longer exists.*`);
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function threadToDocx(doc: ThreadDocument, format: CitationFormatter = (c) => c): Promise<Buffer> {
  const notes = format(citationsOf(doc));
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  notes.forEach((note, index) => {
    footnotes[index + 1] = { children: [new Paragraph({ children: [new TextRun(note)] })] };
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
  if (doc.missing) {
    children.push(new Paragraph({ children: [new TextRun({ text: `${doc.missing} item${doc.missing === 1 ? "" : "s"} could not be exported because the original no longer exists.`, italics: true })] }));
  }

  const file = new Document({
    creator: "Scriptorium",
    title: doc.title,
    footnotes,
    sections: [{ children }]
  });
  return await Packer.toBuffer(file);
}
