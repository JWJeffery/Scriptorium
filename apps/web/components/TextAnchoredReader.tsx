"use client";

import { useMemo, useRef } from "react";

export type TextSelectionAnchor = {
  selectedText: string;
  pageNumber: number;
  beforeContext: string;
  afterContext: string;
  startOffset: number;
  endOffset: number;
  lineStart: number;
  lineEnd: number;
  locatorKind: "line";
  rects: [];
};

export type TextPageHighlight = {
  id: string;
  color: string;
  anchor: TextSelectionAnchor;
};

type Props = {
  text: string;
  highlights: TextPageHighlight[];
  onSelectionCapture: (anchor: TextSelectionAnchor) => void;
  onStatusChange: (status: string) => void;
};

type Segment = {
  text: string;
  highlightId?: string;
  color?: string;
};

function lineForOffset(text: string, offset: number) {
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

function offsetForNode(root: Node, targetNode: Node, targetOffset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node = walker.nextNode();

  while (node) {
    if (node === targetNode) {
      return offset + targetOffset;
    }

    offset += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }

  return offset;
}

function segmentsFor(text: string, highlights: TextPageHighlight[]) {
  const normalized = highlights
    .map((highlight) => ({
      id: highlight.id,
      color: highlight.color,
      start: highlight.anchor.startOffset,
      end: highlight.anchor.endOffset
    }))
    .filter((highlight) => highlight.start >= 0 && highlight.end > highlight.start && highlight.end <= text.length)
    .sort((left, right) => left.start - right.start);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const highlight of normalized) {
    if (highlight.start < cursor) continue;

    if (highlight.start > cursor) {
      segments.push({ text: text.slice(cursor, highlight.start) });
    }

    segments.push({ text: text.slice(highlight.start, highlight.end), highlightId: highlight.id, color: highlight.color });
    cursor = highlight.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }

  return segments.length ? segments : [{ text }];
}

export function TextAnchoredReader({ text, highlights, onSelectionCapture, onStatusChange }: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const segments = useMemo(() => segmentsFor(text, highlights), [text, highlights]);

  function captureSelection() {
    const selection = window.getSelection();
    const frame = frameRef.current;

    if (!selection || selection.rangeCount === 0 || !frame) return;

    const range = selection.getRangeAt(0);
    if (!frame.contains(range.commonAncestorContainer)) return;

    const startOffset = offsetForNode(frame, range.startContainer, range.startOffset);
    const endOffset = offsetForNode(frame, range.endContainer, range.endOffset);
    const start = Math.min(startOffset, endOffset);
    const end = Math.max(startOffset, endOffset);
    const selectedText = text.slice(start, end);

    if (!selectedText.trim()) return;

    const anchor: TextSelectionAnchor = {
      selectedText,
      pageNumber: 1,
      beforeContext: text.slice(Math.max(0, start - 160), start),
      afterContext: text.slice(end, Math.min(text.length, end + 160)),
      startOffset: start,
      endOffset: end,
      lineStart: lineForOffset(text, start),
      lineEnd: lineForOffset(text, end),
      locatorKind: "line",
      rects: []
    };

    onSelectionCapture(anchor);
    onStatusChange(`Captured text anchor at line ${anchor.lineStart}${anchor.lineEnd === anchor.lineStart ? "" : `-${anchor.lineEnd}`}.`);
  }

  return (
    <div className="textReaderShell" onMouseUp={captureSelection} ref={frameRef}>
      {segments.map((segment, index) => segment.highlightId ? (
        <mark className="textHighlight" data-highlight-id={segment.highlightId} key={`${segment.highlightId}-${index}`} style={{ background: segment.color }}>
          {segment.text}
        </mark>
      ) : (
        <span key={`plain-${index}`}>{segment.text}</span>
      ))}
    </div>
  );
}
