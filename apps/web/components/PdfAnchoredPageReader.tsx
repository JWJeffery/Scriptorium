"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { mergeLineRects, snapRectsToOcrLines } from "../lib/highlight-geometry";
import { matchWordIndexes } from "../lib/search-text";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type PdfViewport = { width: number; height: number; transform: number[] };
type PdfMetadata = { info?: Record<string, unknown>; metadata?: { get: (key: string) => string | null } | null };
type PdfPage = {
  getViewport: (args: { scale: number }) => PdfViewport;
  getTextContent: () => Promise<{ items: unknown[] }>;
  render: (args: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; transform?: number[] }) => { promise: Promise<void> };
};
type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  getMetadata?: () => Promise<PdfMetadata>;
  destroy: () => Promise<void> | void;
};
type TextItemLike = { str: string; transform: number[]; width?: number; height?: number };
type TextRun = { index: number; text: string; left: number; top: number; fontSize: number; width?: number };
export type PdfAuthoritativeWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  blockNum?: number;
  lineNum?: number;
};

export type PdfAnchorRect = { left: number; top: number; width: number; height: number };
export type PdfSelectionAnchor = {
  selectedText: string;
  pageNumber: number;
  beforeContext: string;
  afterContext: string;
  rects: PdfAnchorRect[];
};
export type PdfPageHighlight = { id: string; color: string; anchor: PdfSelectionAnchor; /** the note text, if any: shows a marker in the margin */ note?: string };
export type PdfEmbeddedMetadata = { title?: string; author?: string; keywords?: string; subject?: string };

type Props = {
  fileUrl: string;
  pageNumber: number;
  pageCount?: number;
  onPageChange?: (pageNumber: number) => void;
  highlights: PdfPageHighlight[];
  onPageCountChange: (pageCount: number) => void;
  onSelectionCapture: (anchor: PdfSelectionAnchor) => void;
  onStatusChange: (status: string) => void;
  onMetadataExtracted?: (metadata: PdfEmbeddedMetadata) => void;
  // Independently-derived text for the current page (server extraction on
  // ingest, or a real OCR pass) - see api/ocr/page-text.
  // When present, a captured selection that doesn't appear anywhere in it
  // gets flagged as possibly corrupted rather than reported as a normal
  // successful capture. Optional and silently skipped when absent (e.g. no
  // extraction/OCR has ever run for this document) - absence of this check
  // is not itself a signal that a capture is trustworthy.
  authoritativePageText?: string | null;
  // Word-level positions from a real OCR pass on this page (same source
  // route). When present, these *replace* pdf.js's own text layer for
  // building the selectable spans - not just a warning after the fact, an
  // actually-correct layer for pages OCR ran on. pdf.js's own extraction
  // (buildTextRuns below) remains the fallback when this is absent, which
  // is the normal case for a genuinely good, non-scanned PDF.
  authoritativeWords?: PdfAuthoritativeWord[] | null;
  // Lives in the parent because selectedText/anchor state lives there -
  // this component just renders the button in its toolbar and calls back.
  hasSelection?: boolean;
  onClearSelection?: () => void;
  // Words from a Search result to light up on this page (null = none).
  searchTerms?: string[] | null;
  onClearSearch?: () => void;
  // Clicking a saved highlight (or its margin marker) on the page.
  onHighlightClick?: (id: string) => void;
  // The full-screen read mode lives in the parent; this renders its button in the page toolbar.
  readMode?: boolean;
  onToggleReadMode?: () => void;
};

function isTextItem(item: unknown): item is TextItemLike {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

function cleanMetadataValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function embeddedMetadataFrom(pdfMetadata: PdfMetadata): PdfEmbeddedMetadata {
  const info = pdfMetadata.info ?? {};
  const metadata = pdfMetadata.metadata;
  const title = cleanMetadataValue(info.Title) || cleanMetadataValue(metadata?.get("dc:title"));
  const author = cleanMetadataValue(info.Author) || cleanMetadataValue(metadata?.get("dc:creator"));
  const subject = cleanMetadataValue(info.Subject) || cleanMetadataValue(metadata?.get("dc:description"));
  const keywords = cleanMetadataValue(info.Keywords) || cleanMetadataValue(metadata?.get("pdf:Keywords"));
  return { title: title || undefined, author: author || undefined, subject: subject || undefined, keywords: keywords || undefined };
}

async function renderCanvas(page: PdfPage, canvas: HTMLCanvasElement, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) throw new Error("Canvas unavailable.");
  // Draw at the screen's real pixel density (2 on a Retina display), keeping the page's size on screen.
  // At 1 the browser stretched the image, which blurred the type and greyed out thin strokes.
  // Capped at 2: a 3x phone screen gains little visibly but would draw (and hold) more than twice the pixels.
  const density = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  canvas.width = Math.floor(viewport.width * density);
  canvas.height = Math.floor(viewport.height * density);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({ canvasContext, viewport, transform: density !== 1 ? [density, 0, 0, density, 0, 0] : undefined }).promise;
  return viewport;
}

export type PageLevels = { paper: number; ink: number };
const DEFAULT_LEVELS: PageLevels = { paper: 0.9, ink: 0.15 };

// How light this page's paper is and how dark its ink is, measured from the rendered image (brightness 0-1).
// Most of a book page is paper, so the median is the paper; the darkest 1.5% is the ink.
function measurePageLevels(canvas: HTMLCanvasElement): PageLevels {
  if (canvas.width === 0 || canvas.height === 0) return DEFAULT_LEVELS;
  // Measured on a smaller copy (at most 800 px wide): the brightness spread is the same, and reading back a whole
  // high-density page from the graphics card is slow on a phone.
  const scale = Math.min(1, 800 / canvas.width);
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(canvas.width * scale));
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return DEFAULT_LEVELS;
  let data: Uint8ClampedArray;
  try {
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    data = context.getImageData(0, 0, sample.width, sample.height).data;
  } catch { return DEFAULT_LEVELS; }
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])] += 1;
    count += 1;
  }
  const percentile = (fraction: number) => {
    let seen = 0;
    for (let level = 0; level < 256; level += 1) { seen += histogram[level]; if (seen >= count * fraction) return level / 255; }
    return 1;
  };
  return { paper: percentile(0.5), ink: percentile(0.015) };
}

// The dark-page filter settings for a page: anything at least as light as (a little under) its paper becomes
// the page colour, anything as dark as its ink becomes full-strength text, the range between is stretched,
// and a gamma lift keeps thin strokes and small type solid instead of fading them.
function darkPageFilterSettings(levels: PageLevels) {
  const paperCut = Math.min(Math.max(levels.paper - 0.08, 0.45), 0.95);
  const inkCut = Math.max(Math.min(levels.ink + 0.04, paperCut - 0.3), 0);
  const span = paperCut - inkCut;
  return { slope: (-1 / span).toFixed(4), intercept: (paperCut / span).toFixed(4) };
}

async function buildTextRuns(page: PdfPage, scale: number) {
  const viewport = page.getViewport({ scale });
  const textContent = await page.getTextContent();
  return textContent.items.filter(isTextItem).map((item, index) => {
    const transform = pdfjsLib.Util.transform(viewport.transform, item.transform as number[]);
    const fontSize = Math.max(Math.hypot(transform[2], transform[3]), 8);
    const width = typeof item.width === "number" ? item.width * scale : undefined;
    return {
      index,
      text: String(item.str),
      left: transform[4],
      top: transform[5] - fontSize,
      fontSize,
      width
    } satisfies TextRun;
  });
}

function runsFromWords(words: PdfAuthoritativeWord[]): TextRun[] {
  if (words.length === 0) return [];
  // Group words into line-level spans rather than one span per word. A
  // normal click-and-drag selection needs to span multiple words, and
  // browsers don't reliably extend a Selection across many small real gaps
  // between separate absolutely-positioned elements with nothing connecting
  // them - each word being its own span meant a drag could only ever pick
  // up one word at a time. pdf.js's own text runs never hit this because
  // they already group whole phrases/lines into a single span; this brings
  // OCR-derived runs in line with that. Word-level position data is still
  // what's stored server-side (useful for finer-grained needs later) - this
  // only changes how it's grouped for rendering the selectable layer.
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  type Line = { words: PdfAuthoritativeWord[]; top: number; bottom: number; left: number; right: number };
  const lines: Line[] = [];
  for (const word of sorted) {
    const wordMid = word.top + word.height / 2;
    const line = lines.find((candidate) => wordMid >= candidate.top && wordMid <= candidate.bottom);
    if (line) {
      line.words.push(word);
      line.top = Math.min(line.top, word.top);
      line.bottom = Math.max(line.bottom, word.top + word.height);
      line.left = Math.min(line.left, word.left);
      line.right = Math.max(line.right, word.left + word.width);
    } else {
      lines.push({ words: [word], top: word.top, bottom: word.top + word.height, left: word.left, right: word.left + word.width });
    }
  }

  // Column ordering: a page scanned as a two-page spread (this book's real
  // layout - see RESUME_PROJECT_NOTE.md) sandwiches the right column's
  // content between two vertically-separated chunks of the left column's
  // content when lines are ordered by top alone - a browser Selection
  // sweeps up everything BETWEEN a drag's start/end points in DOM order,
  // not visual order, so a drag confined to one column could pull in the
  // other column's interleaved lines.
  //
  // Tesseract's own block_num (server-side, now that PSM defaults to
  // real automatic layout analysis instead of being forced into a single
  // block - see tesseract-ocr-provider.ts) is the right, established
  // answer to "which column is this on" - its layout engine actually
  // examined the image, rather than reconstructing an approximation from
  // word positions after the fact. Preferred whenever at least two
  // distinct block numbers are actually present.
  //
  // Falls back to a largest-gap heuristic (classic XY-cut column
  // detection - Nagy & Seth 1984) only when block_num data is missing or
  // collapsed to a single value, which is what happens for OCR runs from
  // before this file forced PSM.SINGLE_BLOCK (now reverted) - so older
  // saved annotations/captures against not-yet-re-OCR'd pages still get
  // reasonable behavior instead of breaking.
  const distinctBlocks = new Set(lines.flatMap((line) => line.words.map((w) => w.blockNum).filter((b): b is number => typeof b === "number")));
  let columnOf: (line: Line) => number;
  if (distinctBlocks.size >= 2) {
    columnOf = (line: Line) => {
      const counts = new Map<number, number>();
      for (const word of line.words) {
        if (typeof word.blockNum !== "number") continue;
        counts.set(word.blockNum, (counts.get(word.blockNum) ?? 0) + 1);
      }
      let best = line.words[0]?.blockNum ?? 0;
      let bestCount = 0;
      for (const [block, count] of counts) {
        if (count > bestCount) {
          best = block;
          bestCount = count;
        }
      }
      return best;
    };
  } else {
    const centers = lines.map((line) => (line.left + line.right) / 2).sort((a, b) => a - b);
    let splitPoint: number | null = null;
    if (centers.length >= 2) {
      const gaps = centers.slice(1).map((c, i) => ({ gap: c - centers[i], afterValue: centers[i] }));
      const maxGapEntry = gaps.reduce((max, g) => (g.gap > max.gap ? g : max), gaps[0]);
      const otherGaps = gaps.filter((g) => g !== maxGapEntry).map((g) => g.gap);
      const avgOtherGap = otherGaps.length > 0 ? otherGaps.reduce((sum, g) => sum + g, 0) / otherGaps.length : 0;
      if (maxGapEntry.gap > 30 && (avgOtherGap === 0 || maxGapEntry.gap > avgOtherGap * 4)) {
        splitPoint = maxGapEntry.afterValue + maxGapEntry.gap / 2;
      }
    }
    columnOf = (line: Line) => (splitPoint === null ? 0 : (line.left + line.right) / 2 <= splitPoint ? 0 : 1);
  }

  return lines
    .sort((a, b) => columnOf(a) - columnOf(b) || a.top - b.top)
    .map((line, index) => {
      const lineWords = [...line.words].sort((a, b) => a.left - b.left);
      const left = Math.min(...lineWords.map((word) => word.left));
      const right = Math.max(...lineWords.map((word) => word.left + word.width));
      const top = Math.min(...lineWords.map((word) => word.top));
      const bottom = Math.max(...lineWords.map((word) => word.top + word.height));
      return {
        index,
        text: lineWords.map((word) => word.text).join(" "),
        left,
        top,
        fontSize: Math.max(bottom - top, 8),
        width: right - left
      } satisfies TextRun;
    });
}

function contextFor(textRuns: TextRun[], selectedText: string) {
  const pageText = textRuns.map((run) => run.text).join(" ").replace(/\s+/g, " ").trim();
  const start = pageText.indexOf(selectedText);
  if (start < 0) return { beforeContext: "", afterContext: "" };
  return {
    beforeContext: pageText.slice(Math.max(0, start - 160), start).trim(),
    afterContext: pageText.slice(start + selectedText.length, start + selectedText.length + 160).trim()
  };
}

function normalizeForCompare(value: string) {
  // Case-insensitive, whitespace-collapsed, punctuation-light comparison -
  // OCR and pdf.js text-layer extraction can legitimately disagree on
  // exact punctuation/spacing for genuinely correct text, so this only
  // needs to be loose enough to not false-flag real matches, not exact.
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// A selection this short (e.g. a single short word) is too easy to match
// coincidentally against unrelated authoritative text to be a meaningful
// check either way, so it's skipped rather than risking a false "verified".
const MIN_LENGTH_TO_CHECK = 8;

function rectsFor(range: Range, frame: HTMLDivElement, scale: number) {
  const frameRect = frame.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((rect) => ({
    left: (rect.left - frameRect.left) / scale,
    top: (rect.top - frameRect.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale
  })).filter((rect) => rect.width > 0 && rect.height > 0);
}

type DragRect = { left: number; top: number; width: number; height: number };

function pointInFrame(event: { clientX: number; clientY: number }, frame: HTMLDivElement, scale: number) {
  const frameRect = frame.getBoundingClientRect();
  return { x: (event.clientX - frameRect.left) / scale, y: (event.clientY - frameRect.top) / scale };
}

function rectFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): DragRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

export function PdfAnchoredPageReader({ fileUrl, pageNumber, pageCount, onPageChange, highlights, onPageCountChange, onSelectionCapture, onStatusChange, onMetadataExtracted, authoritativePageText, authoritativeWords, hasSelection, onClearSelection, searchTerms, onClearSearch, onHighlightClick, readMode, onToggleReadMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const [pdfTextRuns, setPdfTextRuns] = useState<TextRun[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [pageLevels, setPageLevels] = useState<PageLevels>(DEFAULT_LEVELS);
  const darkFilter = darkPageFilterSettings(pageLevels);
  const [isLoading, setIsLoading] = useState(false);
  const [documentLoadKey, setDocumentLoadKey] = useState(0);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // Real scanned pages - especially two-page spreads scanned as a single
  // image, like this book - can be wider than the middle grid column has
  // room for, at some perfectly normal browser window widths. Rather than
  // letting the page overflow/clip or forcing a horizontal scrollbar
  // that's easy to miss, this tracks how much width is actually available
  // and shrinks the whole page (canvas, highlights, drag-selection layer -
  // everything, via a single CSS transform on the shared parent) to fit,
  // without changing anything about the pixel coordinate space every OCR
  // word position, highlight rectangle, and drag rectangle is computed in.
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") setContainerWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Never scale up past the page's real size on its own - only shrink to
  // fit when the available space is genuinely narrower than the page.
  // Reading a real scanned page shrunk to fit a narrow window can still be
  // too small to read comfortably (small print, a two-page spread), so
  // zoomLevel is a person-controlled multiplier on top of that baseline -
  // 1 means "whatever fits", and the buttons below adjust it up or down
  // from there.
  const fitScale = pageSize.width > 0 && containerWidth > 0 ? Math.min(1, containerWidth / pageSize.width) : 1;
  const [zoomLevel, setZoomLevel] = useState(1);
  const finalScale = fitScale * zoomLevel;
  const ZOOM_STEP = 0.25;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 3;

  // Fit the page to the width of the reading area (and enlarge small pages to do so).
  const fitWidth = () => {
    if (pageSize.width <= 0 || containerWidth <= 0 || fitScale <= 0) return;
    const wanted = (containerWidth / pageSize.width) / fitScale;
    setZoomLevel(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(wanted * 100) / 100)));
  };
  // Keyboard shortcuts in the page ("+", "-", "0", "f") reach the reader as an event.
  useEffect(() => {
    function onZoomCommand(event: Event) {
      const command = (event as CustomEvent<string>).detail;
      if (command === "in") setZoomLevel((level) => Math.min(MAX_ZOOM, Math.round((level + ZOOM_STEP) * 100) / 100));
      else if (command === "out") setZoomLevel((level) => Math.max(MIN_ZOOM, Math.round((level - ZOOM_STEP) * 100) / 100));
      else if (command === "reset") setZoomLevel(1);
      else if (command === "fit") fitWidth();
    }
    window.addEventListener("scriptorium-zoom", onZoomCommand);
    return () => window.removeEventListener("scriptorium-zoom", onZoomCommand);
    // fitWidth reads the latest sizes each render; re-subscribe when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize.width, containerWidth, fitScale]);

  // Scrolling carries on from page to page: scroll past the bottom of a page and the next one opens
  // at its top; scroll up past the top and the previous one opens at its bottom. A short extra pull
  // is needed first so a stray flick at the edge does not turn the page.
  const turnRef = useRef({ pageNumber, pageCount, onPageChange });
  const swipeBlockedRef = useRef(false);
  turnRef.current = { pageNumber, pageCount, onPageChange };
  const pendingScrollRef = useRef<"top" | "bottom" | null>(null);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const PULL_NEEDED = 140;
    const COOLDOWN_MS = 450;
    let pull = 0;
    let lastTurn = 0;
    let resetTimer: number | undefined;
    function onWheel(event: WheelEvent) {
      // Pinch-zoom gestures and sideways scrolling are not page turns.
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const { pageNumber: current, pageCount: total, onPageChange: change } = turnRef.current;
      if (!change) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      const down = delta > 0;
      const atEdge = down ? node!.scrollTop + node!.clientHeight >= node!.scrollHeight - 2 : node!.scrollTop <= 0;
      const canTurn = down ? !total || current < total : current > 1;
      if (!atEdge || !canTurn) { pull = 0; return; }
      if (Date.now() - lastTurn < COOLDOWN_MS) { event.preventDefault(); return; }
      if (Math.sign(pull) !== Math.sign(delta)) pull = 0;
      pull += delta;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => { pull = 0; }, 350);
      if (Math.abs(pull) < PULL_NEEDED) return;
      pull = 0;
      lastTurn = Date.now();
      pendingScrollRef.current = down ? "top" : "bottom";
      event.preventDefault();
      change(down ? current + 1 : current - 1);
    }
    node.addEventListener("wheel", onWheel, { passive: false });

    // On a touch screen the page turns the same way as with a mouse or trackpad: scroll down to the bottom of the
    // page (on a phone the whole page usually fits, so it is already there), keep pulling, and let go: the next
    // page opens. At the top, pulling down goes back a page. A hint shows once the pull is far enough. A short
    // drag, a two-finger gesture, a pinch-zoomed screen, or a drag that is selecting text or drawing a box never
    // turns the page, and the pull is claimed so the browser does not also "pull to refresh".
    const TOUCH_PULL_NEEDED = 110;
    let touch: { lastY: number; pull: number } | null = null;
    const atBottom = () => node!.scrollTop + node!.clientHeight >= node!.scrollHeight - 2 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    const atTop = () => node!.scrollTop <= 0 && window.scrollY <= 0;
    const showPull = (direction: "next" | "previous" | null) => { if (direction) node!.dataset.pull = direction; else delete node!.dataset.pull; };
    function onTouchStart(event: TouchEvent) {
      touch = event.touches.length === 1 ? { lastY: event.touches[0].clientY, pull: 0 } : null;
    }
    function onTouchMove(event: TouchEvent) {
      if (!touch) return;
      if (event.touches.length !== 1 || swipeBlockedRef.current || (window.visualViewport?.scale ?? 1) > 1.05) { touch = null; showPull(null); return; }
      const y = event.touches[0].clientY;
      const step = touch.lastY - y; // > 0: finger moving up (scrolling down the page)
      touch.lastY = y;
      if (step > 0 && atBottom()) touch.pull = Math.max(0, touch.pull) + step;
      else if (step < 0 && atTop()) touch.pull = Math.min(0, touch.pull) + step;
      else if (step !== 0 && Math.sign(step) !== Math.sign(touch.pull)) touch.pull = 0;
      const { pageNumber: current, pageCount: total } = turnRef.current;
      const canNext = !total || current < total;
      const canPrevious = current > 1;
      if ((touch.pull > 8 && canNext) || (touch.pull < -8 && canPrevious)) {
        if (event.cancelable) event.preventDefault();
        showPull(touch.pull >= TOUCH_PULL_NEEDED && canNext ? "next" : touch.pull <= -TOUCH_PULL_NEEDED && canPrevious ? "previous" : null);
      }
    }
    function onTouchEnd() {
      const pulled = touch?.pull ?? 0;
      touch = null;
      showPull(null);
      if (Math.abs(pulled) < TOUCH_PULL_NEEDED || swipeBlockedRef.current) return;
      if ((window.getSelection()?.toString() ?? "").trim()) return;
      const { pageNumber: current, pageCount: total, onPageChange: change } = turnRef.current;
      const next = pulled > 0;
      if (!change || (next ? (total ?? 0) > 0 && current >= (total ?? 0) : current <= 1)) return;
      if (Date.now() - lastTurn < COOLDOWN_MS) return;
      lastTurn = Date.now();
      pendingScrollRef.current = next ? "top" : "bottom";
      change(next ? current + 1 : current - 1);
    }
    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    node.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
      window.clearTimeout(resetTimer);
    };
  }, []);

  // Once a page has drawn, put the view where the reader expects: the top when moving forward (or
  // jumping), the bottom when scrolling back into the previous page.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const where = pendingScrollRef.current ?? "top";
    pendingScrollRef.current = null;
    const frame = window.requestAnimationFrame(() => { node.scrollTop = where === "top" ? 0 : node.scrollHeight; });
    return () => window.cancelAnimationFrame(frame);
  }, [pdfTextRuns]);

  // A click (not a drag) on a saved highlight opens it.
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  function rememberPress(event: React.MouseEvent) { pressRef.current = { x: event.clientX, y: event.clientY }; }
  function handleFrameClick(event: React.MouseEvent) {
    const press = pressRef.current;
    pressRef.current = null;
    if (!onHighlightClick || !press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const frame = frameRef.current;
    if (!frame) return;
    const point = pointInFrame(event, frame, finalScale);
    const hit = [...highlights].reverse().find((highlight) => highlight.anchor.pageNumber === pageNumber && highlight.id !== "active-selection-preview" && highlightRectsFor(highlight.anchor.rects).some((rect) => point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height));
    if (hit) onHighlightClick(hit.id);
  }

  const usingOcrLayer = Boolean(authoritativeWords && authoritativeWords.length > 0);
  // The rectangle-drag "selection box" mode exists because native browser
  // text selection was unreliable on top of genuinely garbled OCR word
  // data - it's not needed on its own merits now that the underlying OCR
  // word positions and reading order are actually correct (see
  // RESUME_PROJECT_NOTE.md for the full arc of getting there). Defaults
  // back to normal highlight-and-select, the familiar behavior for every
  // non-OCR page, with the box kept available as an explicit alternative
  // for cases where a precise geometric drag is still genuinely useful
  // (e.g. a page where OCR reading order is known to be off, or a region
  // that's hard to cleanly text-select for some other reason).
  const [selectionMode, setSelectionMode] = useState<"highlight" | "box">("highlight");
  const useBoxSelection = usingOcrLayer && selectionMode === "box";
  swipeBlockedRef.current = useBoxSelection || Boolean(hasSelection);
  const textRuns = usingOcrLayer ? runsFromWords(authoritativeWords!) : pdfTextRuns;

  // The invisible text layer is drawn in the browser's own font, which is rarely the same width as the
  // PDF's. Left alone, a line of it runs past (or stops short of) the printed line it sits over, so a
  // selection - and the highlight saved from it - overshoots into the margin by however much wider the
  // browser's font is on that line (each line by a different amount). Stretch or shrink each run
  // horizontally to the width the PDF reports for it, as pdf.js's own text layer does, so selection and
  // highlight geometry match the printed text. OCR pages are left as they are: their highlights are
  // already clipped to the OCR word boxes (snapRectsToOcrLines).
  useLayoutEffect(() => {
    const layer = textLayerRef.current;
    if (!layer || usingOcrLayer) return;
    layer.querySelectorAll<HTMLElement>(".pdfTextRun").forEach((el) => {
      const run = textRuns[Number(el.dataset.textRunIndex)];
      el.style.transform = "";
      if (!run || !run.width || run.width <= 0) return;
      // scrollWidth is layout width in page units: unaffected by the zoom transform on an ancestor.
      const natural = el.scrollWidth;
      if (natural > 0) el.style.transform = `scaleX(${run.width / natural})`;
    });
  }, [textRuns, usingOcrLayer]);

  // Text-layer runs as word-like boxes, used to clip highlights on pages without OCR to where each
  // printed line actually ends (fixes highlights saved before the runs were scaled, too).
  const runBoxes = usingOcrLayer ? null : pdfTextRuns
    .filter((run) => run.width && run.width > 0 && run.text.trim())
    .map((run) => ({ left: run.left, top: run.top, width: run.width as number, height: run.fontSize, text: run.text }));
  const highlightRectsFor = (rects: PdfAnchorRect[]) =>
    usingOcrLayer ? snapRectsToOcrLines(rects, authoritativeWords)
      : runBoxes && runBoxes.length > 0 ? snapRectsToOcrLines(rects, runBoxes) : mergeLineRects(rects);

  // Search hits: precise word boxes where OCR positions exist, otherwise the
  // text runs the PDF itself reports.
  const searchRects: PdfAnchorRect[] = (() => {
    if (!searchTerms || searchTerms.length === 0) return [];
    if (usingOcrLayer && authoritativeWords) {
      const hits = matchWordIndexes(authoritativeWords.map((word) => word.text), searchTerms);
      return snapRectsToOcrLines(hits.map((index) => authoritativeWords[index]), authoritativeWords);
    }
    // The PDF reports whole lines, so place each matched word by its share of
    // the line's characters (exact for monospaced text, close for the rest).
    const tokens = searchTerms.flatMap((term) => term.toLowerCase().split(/\s+/)).filter(Boolean);
    const rects: PdfAnchorRect[] = [];
    for (const run of pdfTextRuns) {
      const lower = run.text.toLowerCase();
      if (!lower.trim()) continue;
      const runWidth = run.width ?? run.fontSize * run.text.length * 0.5;
      const perChar = runWidth / run.text.length;
      const phrase = tokens.join(" ");
      const spans: Array<[number, number]> = [];
      const phraseAt = tokens.length > 1 ? lower.indexOf(phrase) : -1;
      if (phraseAt >= 0) spans.push([phraseAt, phrase.length]);
      else {
        for (const token of new Set(tokens)) {
          let from = 0;
          for (let at = lower.indexOf(token, from); at >= 0; at = lower.indexOf(token, from)) {
            spans.push([at, token.length]);
            from = at + token.length;
          }
        }
      }
      for (const [at, length] of spans) rects.push({ left: run.left + at * perChar, top: run.top, width: length * perChar, height: run.fontSize * 1.2 });
    }
    return rects;
  })();

  useEffect(() => {
    if (usingOcrLayer) {
      onStatusChange(`Using this page's real OCR text for selection instead of the PDF's own text layer (${authoritativeWords!.length} word${authoritativeWords!.length === 1 ? "" : "s"}).`);
    }
    // Only fire when the OCR layer actually becomes active for the current
    // page - not on every unrelated status change elsewhere in the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingOcrLayer, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    async function loadDocument() {
      setIsLoading(true);
      try {
        // From the server, fetch only the parts of the file the open page needs (the server answers byte-range
        // requests), so a 40 MB scan shows its first page in seconds on a phone instead of after downloading it
        // all. A copy already in this browser (a blob: address) is read directly.
        const fromServer = !fileUrl.startsWith("blob:");
        const pdfDocument = (await pdfjsLib.getDocument({ url: fileUrl, rangeChunkSize: 256 * 1024, disableAutoFetch: fromServer, disableStream: fromServer }).promise) as unknown as PdfDocument;
        if (cancelled) return;
        if (documentRef.current) await documentRef.current.destroy();
        documentRef.current = pdfDocument;
        onPageCountChange(pdfDocument.numPages);
        setDocumentLoadKey((value) => value + 1);
        if (pdfDocument.getMetadata && onMetadataExtracted) {
          try {
            const metadata = embeddedMetadataFrom(await pdfDocument.getMetadata());
            if (metadata.title || metadata.author || metadata.subject || metadata.keywords) onMetadataExtracted(metadata);
          } catch {
            // PDF metadata is optional and often malformed; ignore metadata failures.
          }
        }
        onStatusChange(`PDF.js loaded ${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"}.`);
      } catch (error) {
        const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
        onStatusChange(`PDF.js could not load this PDF.${detail}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadDocument();
    return () => { cancelled = true; };
  }, [fileUrl, onMetadataExtracted, onPageCountChange, onStatusChange]);

  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      const pdfDocument = documentRef.current;
      const canvas = canvasRef.current;
      if (!pdfDocument || !canvas) return;
      setIsLoading(true);
      try {
        const safePageNumber = Math.min(Math.max(pageNumber, 1), pdfDocument.numPages);
        const page = await pdfDocument.getPage(safePageNumber);
        const scale = 1;
        const viewport = await renderCanvas(page, canvas, scale);
        const runs = await buildTextRuns(page, scale);
        if (cancelled) return;
        setPageSize({ width: viewport.width, height: viewport.height });
        setPageLevels(measurePageLevels(canvas));
        setPdfTextRuns(runs);
        onStatusChange(
          runs.length > 0
            ? `Rendered PDF page ${safePageNumber} with selectable text layer.`
            : `Rendered image-only PDF page ${safePageNumber}. Run OCR before attempting to select text.`
        );
      } catch {
        if (!cancelled) onStatusChange("Could not render this PDF page.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    renderPage();
    return () => { cancelled = true; };
  }, [pageNumber, documentLoadKey, onStatusChange]);

  // Two consecutive attempts at making the browser's native text selection
  // work over an invisible, synthetic text layer (over an OCR'd page image)
  // both failed on the same underlying issue: browsers don't reliably map
  // mouse position to the correct character within text that isn't the
  // page's own real, natively-laid-out content - not even with a computed
  // CSS scaleX correction. Real word positions from OCR are trustworthy
  // data; the problem was routing selection through browser text hit-testing
  // at all. This replaces that entirely for OCR pages: track the drag as a
  // plain rectangle in page coordinates, then directly test which known
  // word boxes it covers - simple, reliable geometry, no browser text-layout
  // guessing involved anywhere in the path.
  function handleOcrMouseDown(event: React.MouseEvent) {
    if (!usingOcrLayer) return;
    const frame = frameRef.current;
    if (!frame) return;
    dragStartRef.current = pointInFrame(event, frame, finalScale);
    setDragRect(null);
  }

  function handleOcrMouseMove(event: React.MouseEvent) {
    if (!usingOcrLayer || !dragStartRef.current) return;
    const frame = frameRef.current;
    if (!frame) return;
    setDragRect(rectFromPoints(dragStartRef.current, pointInFrame(event, frame, finalScale)));
  }

  function handleOcrMouseUp() {
    const start = dragStartRef.current;
    const rect = dragRect;
    dragStartRef.current = null;
    setDragRect(null);
    if (!usingOcrLayer || !start || !rect || !authoritativeWords) return;
    // A tiny drag (or a plain click) shouldn't be treated as a selection.
    if (rect.width < 3 && rect.height < 3) return;

    // A word counts as selected if its center falls inside the dragged
    // rectangle - more predictable than "any overlap" for a person dragging
    // roughly across the words they mean to select.
    const rawMatched = authoritativeWords.filter((word) => {
      const centerX = word.left + word.width / 2;
      const centerY = word.top + word.height / 2;
      return centerX >= rect.left && centerX <= rect.left + rect.width && centerY >= rect.top && centerY <= rect.top + rect.height;
    });
    if (rawMatched.length === 0) return;

    // A rectangle drag is drawn in screen space and has no idea it might be
    // geometrically sweeping across two visually separate things that
    // happen to share a y-range - e.g. a main paragraph and a smaller
    // marginal citation/attribution block sitting to its right on roughly
    // the same lines. Tesseract's own block_num groups words by the region
    // its layout analysis actually detected, so when the raw match spans
    // more than one block, keep only the block with the most matched words
    // (the one the person was most likely actually trying to select) and
    // drop the rest, rather than silently joining fragments from two
    // unrelated regions into one nonsensical string. Only applies when
    // every matched word actually has a blockNum (older, pre-this-fix
    // stored OCR data won't) - falls back to the old "use everything"
    // behavior otherwise rather than guessing.
    const allHaveBlockInfo = rawMatched.every((word) => typeof word.blockNum === "number");
    let matched = rawMatched;
    let excludedOtherBlockCount = 0;
    if (allHaveBlockInfo) {
      const countsByBlock = new Map<number, number>();
      for (const word of rawMatched) {
        const key = word.blockNum as number;
        countsByBlock.set(key, (countsByBlock.get(key) ?? 0) + 1);
      }
      if (countsByBlock.size > 1) {
        let dominantBlock = rawMatched[0].blockNum as number;
        let dominantCount = 0;
        for (const [block, count] of countsByBlock) {
          if (count > dominantCount) {
            dominantBlock = block;
            dominantCount = count;
          }
        }
        matched = rawMatched.filter((word) => word.blockNum === dominantBlock);
        excludedOtherBlockCount = rawMatched.length - matched.length;
      }
    }
    if (matched.length === 0) return;

    // Reading order: words on the same visual line don't share an exact
    // top coordinate - OCR bounding boxes jitter by a few pixels per word
    // (ascenders, descenders, baseline noise), so sorting by raw top before
    // left treats "There's" and "Church" (both landed at top=191) as
    // belonging before "be said for the" (top=192) even though they're
    // all on the same line - scrambling the reading order into something
    // like "There's Church be said for the...". Tesseract's own
    // blockNum/lineNum (from the TSV line-grouping, not per-word pixel
    // noise) is the authoritative answer to "which line is this word on" -
    // use that when every matched word has it. Falls back to a
    // tolerance-based top comparison (same line if vertical midpoints are
    // within a few pixels) for older stored OCR data that predates
    // lineNum being captured, rather than crashing or guessing wrong.
    const allHaveLineInfo = matched.every((word) => typeof word.blockNum === "number" && typeof word.lineNum === "number");
    const sorted = allHaveLineInfo
      ? [...matched].sort(
          (a, b) => (a.blockNum as number) - (b.blockNum as number) || (a.lineNum as number) - (b.lineNum as number) || a.left - b.left
        )
      : [...matched].sort((a, b) => {
          const aMid = a.top + a.height / 2;
          const bMid = b.top + b.height / 2;
          const sameLine = Math.abs(aMid - bMid) < Math.min(a.height, b.height) * 0.6;
          return sameLine ? a.left - b.left : a.top - b.top;
        });
    const selectedText = sorted.map((word) => word.text).join(" ");
    const rects = snapRectsToOcrLines(sorted.map((word) => ({ left: word.left, top: word.top, width: word.width, height: word.height })), authoritativeWords);

    onSelectionCapture({ selectedText, pageNumber, ...contextFor(textRuns, selectedText), rects });
    const coverageNote = excludedOtherBlockCount > 0
      ? ` (${excludedOtherBlockCount} word${excludedOtherBlockCount === 1 ? "" : "s"} from an overlapping but visually separate region - e.g. a marginal note or citation - were excluded; redraw a tighter selection if you meant to include it.)`
      : "";
    onStatusChange(
      `Captured ${sorted.length} word${sorted.length === 1 ? "" : "s"} and ${rects.length} anchor rectangle${rects.length === 1 ? "" : "s"} from real OCR word positions (no browser text-selection involved).${coverageNote}`
    );
  }

  function captureSelection() {
    const selection = window.getSelection();
    const frame = frameRef.current;
    const textLayer = textLayerRef.current;
    if (!selection || selection.rangeCount === 0 || !frame || !textLayer) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return;
    if (!textLayer.contains(range.commonAncestorContainer)) return;

    // Reconstruct the selected text from the structured textRuns array
    // rather than trusting Selection.toString() across multiple lines.
    // Real capture confirmed this breaking: "THEOLOGYAT CLAREMONTCalifornia"
    // - words from different lines glued with no space at all. Each
    // .pdfTextRun span is position:absolute, so a plain space text node
    // sitting between two of them (tried as an earlier fix) sits outside
    // normal flow relative to its siblings and can get collapsed away by
    // the browser rather than serialized as a real space. Only the first
    // and last touched runs (which may be only partially selected, if the
    // drag started/ended mid-line) use a DOM sub-range - and only ever a
    // sub-range that stays within a single run's own text node, which has
    // no cross-run boundary and so can't hit the same collapsing issue.
    // Every run strictly between them uses its full stored text directly,
    // sidestepping the DOM/whitespace question entirely.
    const runElements = Array.from(textLayer.querySelectorAll<HTMLElement>(".pdfTextRun"));
    const touched = runElements.filter((el) => range.intersectsNode(el));
    if (touched.length === 0) return;

    const parts: string[] = [];
    touched.forEach((el, i) => {
      const runIndex = Number(el.dataset.textRunIndex);
      const run = textRuns[runIndex];
      const textNode = el.firstChild;
      if (!run || !textNode) return;
      const isFirst = i === 0;
      const isLast = i === touched.length - 1;
      if (isFirst && isLast) {
        const subRange = document.createRange();
        subRange.setStart(range.startContainer, range.startOffset);
        subRange.setEnd(range.endContainer, range.endOffset);
        parts.push(subRange.toString());
      } else if (isFirst) {
        const subRange = document.createRange();
        subRange.setStart(range.startContainer, range.startOffset);
        subRange.setEnd(textNode, textNode.textContent?.length ?? 0);
        parts.push(subRange.toString());
      } else if (isLast) {
        const subRange = document.createRange();
        subRange.setStart(textNode, 0);
        subRange.setEnd(range.endContainer, range.endOffset);
        parts.push(subRange.toString());
      } else {
        parts.push(run.text);
      }
    });

    const selectedText = parts.join(" ").replace(/\s+/g, " ").trim();
    if (!selectedText) return;

    const rects = highlightRectsFor(rectsFor(range, frame, finalScale));
    selection.removeAllRanges();
    onSelectionCapture({ selectedText, pageNumber, ...contextFor(textRuns, selectedText), rects });

    if (!usingOcrLayer && authoritativePageText && selectedText.length >= MIN_LENGTH_TO_CHECK) {
      const corroborated = normalizeForCompare(authoritativePageText).includes(normalizeForCompare(selectedText));
      if (!corroborated) {
        onStatusChange(
          `Captured "${selectedText.slice(0, 60)}${selectedText.length > 60 ? "\u2026" : ""}" - but this text does not appear in this page's independently extracted/OCR'd text. The source PDF's embedded text layer may be corrupted here (this happens with malformed fonts). Verify very carefully before saving, or consider that this capture may not reflect the real content of the page.`
        );
        return;
      }
    }

    onStatusChange(`Captured selected text and ${rects.length} anchor rectangle${rects.length === 1 ? "" : "s"} from the ${usingOcrLayer ? "verified OCR" : "PDF.js"} text layer.`);
  }

  return (
    <div className="pdfReaderShell">
      <div className="pdfToolbar">
        {onPageChange ? (
          <div className="pdfPageControls" aria-label="PDF page navigation">
            <button type="button" onClick={() => onPageChange(pageNumber - 1)} disabled={pageNumber <= 1} aria-label="Previous PDF page">‹</button>
            <span>PDF <strong>{pageNumber}</strong> / {pageCount || "–"}</span>
            <button type="button" onClick={() => onPageChange(pageNumber + 1)} disabled={Boolean(pageCount && pageNumber >= pageCount)} aria-label="Next PDF page">›</button>
          </div>
        ) : null}
        <div className={`pdfSelectionModeToggle${usingOcrLayer ? "" : " unavailable"}`} role="group" aria-label="Text selection mode" title={usingOcrLayer ? undefined : "Available on pages with a scanned-text (OCR) layer"}>
          <button
            type="button"
            className={selectionMode === "highlight" ? "active" : undefined}
            onClick={() => setSelectionMode("highlight")}
            disabled={!usingOcrLayer}
            aria-label="Highlight text"
            title="Highlight text: select words by dragging across them"
          >
            Text
          </button>
          <button
            type="button"
            className={selectionMode === "box" ? "active" : undefined}
            onClick={() => setSelectionMode("box")}
            disabled={!usingOcrLayer}
            aria-label="Selection box"
            title="Selection box: draw a rectangle around the words"
          >
            Box
          </button>
        </div>
        <div className="pdfZoomControls">
          <button
            type="button"
            onClick={() => setZoomLevel((level) => Math.max(MIN_ZOOM, Math.round((level - ZOOM_STEP) * 100) / 100))}
            disabled={zoomLevel <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            &minus;
          </button>
          <span className="pdfZoomLevel">{Math.round(finalScale * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoomLevel((level) => Math.min(MAX_ZOOM, Math.round((level + ZOOM_STEP) * 100) / 100))}
            disabled={zoomLevel >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            +
          </button>
          <button type="button" className="pdfZoomReset" onClick={fitWidth} title="Fit the page to the width of the reading area (f)">
            Fit width
          </button>
          <button type="button" className="pdfZoomReset pdfZoomHundred" onClick={() => setZoomLevel(1)} disabled={zoomLevel === 1}>
            100%
          </button>
        </div>
        {onToggleReadMode ? (
          <div className="pdfZoomControls pdfReadModeControl">
            <button
              type="button"
              className="pdfReadModeButton"
              onClick={onToggleReadMode}
              aria-pressed={Boolean(readMode)}
              aria-label={readMode ? "Leave full-screen read mode" : "Full-screen read mode"}
              title={readMode ? "Leave full-screen read mode (Esc or z)" : "Full-screen read mode (z)"}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {readMode
                  ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                  : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
              </svg>
            </button>
          </div>
        ) : null}
        {(searchTerms && searchTerms.length > 0) || hasSelection ? <div className="pdfToolbarExtras">
        {searchTerms && searchTerms.length > 0 ? (
          <button type="button" className="pdfClearSelection" onClick={onClearSearch} title="Remove the search highlight">
            Search: {searchTerms.join(" ")} ✕
          </button>
        ) : null}
        {hasSelection ? (
          <button type="button" className="pdfClearSelection" data-kind="selection" onClick={onClearSelection}>
            Clear selection
          </button>
        ) : null}
        </div> : null}
      </div>
      {isLoading ? <div className="pdfLoading">Rendering PDF page…</div> : null}
      <div
        className="pdfFrameViewport"
        ref={viewportRef}
        style={{ height: pageSize.height ? pageSize.height * finalScale : undefined }}
      >
        <div
          className="pdfScaledBox"
          style={{ width: pageSize.width ? pageSize.width * finalScale : undefined, height: pageSize.height ? pageSize.height * finalScale : undefined }}
        >
        <div
          className="pdfPageFrame"
          onMouseUp={useBoxSelection ? handleOcrMouseUp : captureSelection}
          onMouseDown={(event) => { rememberPress(event); if (useBoxSelection) handleOcrMouseDown(event); }}
          onClick={handleFrameClick}
          onMouseMove={useBoxSelection ? handleOcrMouseMove : undefined}
          ref={frameRef}
          style={{
            width: pageSize.width || undefined,
            height: pageSize.height || undefined,
            transform: finalScale !== 1 ? `scale(${finalScale})` : undefined,
            transformOrigin: "top left"
          }}
        >
          <svg className="pdfDarkPageFilterDefs" aria-hidden="true" focusable="false" width="0" height="0">
            {/* Dark-theme page rendering (used by styles.css). A plain inversion leaves a scan's grey or
                yellowed paper as a muddy mid-tone with dim text. Instead each pixel's brightness is mapped
                through this page's own paper and ink levels (darkPageFilterSettings), lifted so thin strokes
                stay solid, and painted from the page colour #171310 to warm light text #ece4d6. */}
            <filter id="pdfDarkPage" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0" />
              <feComponentTransfer>
                <feFuncR type="linear" slope={darkFilter.slope} intercept={darkFilter.intercept} />
                <feFuncG type="linear" slope={darkFilter.slope} intercept={darkFilter.intercept} />
                <feFuncB type="linear" slope={darkFilter.slope} intercept={darkFilter.intercept} />
              </feComponentTransfer>
              <feComponentTransfer>
                <feFuncR type="gamma" exponent="0.6" />
                <feFuncG type="gamma" exponent="0.6" />
                <feFuncB type="gamma" exponent="0.6" />
              </feComponentTransfer>
              <feComponentTransfer>
                <feFuncR type="linear" slope="0.8353" intercept="0.0902" />
                <feFuncG type="linear" slope="0.8196" intercept="0.0745" />
                <feFuncB type="linear" slope="0.7765" intercept="0.0627" />
              </feComponentTransfer>
            </filter>
          </svg>
          <canvas ref={canvasRef} className="pdfCanvas" />
          <div className="pdfHighlightLayer" aria-hidden="true">
            {highlights.filter((highlight) => highlight.anchor.pageNumber === pageNumber).flatMap((highlight) =>
              highlightRectsFor(highlight.anchor.rects).map((rect, index) => (
                <span className="pdfHighlightBox" key={`${highlight.id}-${index}`} style={{ background: highlight.color, left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
              ))
            )}
            {highlights.filter((highlight) => highlight.note && highlight.anchor.pageNumber === pageNumber && highlight.id !== "active-selection-preview").map((highlight) => {
              const first = highlight.anchor.rects[0];
              if (!first) return null;
              return (
                <button type="button" key={`note-${highlight.id}`} className="pdfNoteMarker" style={{ top: first.top, background: highlight.color }} title={highlight.note} aria-label={`Open note: ${highlight.note}`} onClick={(event) => { event.stopPropagation(); onHighlightClick?.(highlight.id); }}>✎</button>
              );
            })}
            {searchRects.map((rect, index) => (
              <span className="pdfSearchBox" key={`search-${index}`} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
            ))}
            {useBoxSelection && dragRect ? (
              <span className="pdfDragRect" style={{ left: dragRect.left, top: dragRect.top, width: dragRect.width, height: dragRect.height }} />
            ) : null}
          </div>
          <div
            className="pdfTextLayer"
            aria-label="Selectable PDF text layer"
            ref={textLayerRef}
            style={useBoxSelection ? { pointerEvents: "none", userSelect: "none", cursor: "default" } : undefined}
          >
            {textRuns.map((run) => (
              <span className="pdfTextRun" data-text-run-index={run.index} key={`${run.index}-${run.text}`} style={{ left: run.left, top: run.top, fontSize: run.fontSize, width: usingOcrLayer ? run.width : undefined }}>
                {run.text}
              </span>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
