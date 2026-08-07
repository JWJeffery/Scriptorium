// Shared between pdf-page-splitter.ts (the main entry point) and
// pdf-gutter-detect-worker.ts (a per-page worker run as its own separate
// OS process - see that file for why process isolation is required, not
// optional). Both need the exact same detection logic, so it lives here
// once rather than being duplicated and risking drift between the two.
import type { Canvas } from "@napi-rs/canvas";

// Same rendering scale as the OCR pipeline (tesseract-ocr-provider.ts) -
// doesn't need to match exactly for correctness (the split coordinate
// gets converted back to PDF point space either way), but keeping it
// consistent means gutter-detection behavior is identical to what's
// already been verified against the real book.
export const RENDER_SCALE = 2;
export const CONTRAST_FACTOR = 2.0;
const GUTTER_SEARCH_BAND = [0.3, 0.7] as const;
const GUTTER_MIN_BLANK_FRACTION = 0.15;
// This threshold is calibrated for the LONGEST-CONTIGUOUS-RUN scoring
// signal below, not a simple aggregate blank fraction - a single
// interruption (a shadow, a stray mark) cuts a longest-run score much
// more severely than it dents an aggregate fraction, so this number
// looks low compared to what an aggregate-fraction threshold would need
// to be, and that's expected, not a mistake. Checked the full real
// 64-page book directly before picking it: the lowest genuine value
// found (a page whose gutter shows visible shadowing from the physical
// curvature of the book near its spine, confirmed directly by visual
// inspection of the source scan, not text) is 0.18, with the next-lowest
// at 0.36 and a further cluster from 0.6 up to the normal ~0.97+ range
// most pages sit in. 0.15 sits below the lowest genuine value with a
// small margin, while the separate ink-density check immediately below
// remains the actual safeguard against false positives on genuine
// single-column pages - a low value here doesn't weaken that safeguard,
// which doesn't depend on it.
//
// A candidate gutter also needs real content on BOTH sides of it - a
// sparse single-column page with a short paragraph and a large blank
// margin can otherwise look exactly like a two-column gutter (the blank
// margin passes the "blank across nearly full height" test just as well
// as a real gutter does). This threshold was raised from an original
// 0.001 after lowering GUTTER_MIN_BLANK_FRACTION above exposed how weak
// that number actually was: it was calibrated against a single totally-
// blank false positive (0.0000 ink on one side) and never tested against
// a more realistic one with some incidental content on the sparse side.
// Built a synthetic single-column test page (real text confined to the
// left ~40%, blank margin covering the rest) and it slipped through at
// 0.001 - the "gutter" it found sat inside a natural word-wrap gap
// within the text block itself, with enough stray ink on the sparse side
// (2.13%) to clear that old bar easily. Checked real ink density on both
// sides of a real spread's split, across the whole 64-page book, for
// calibration: the lowest genuine value found was 3.59%. This threshold
// sits with real margin below that real minimum and above the false
// positive's value, and the synthetic test now correctly returns null.
const GUTTER_MIN_INK_FRACTION_PER_SIDE = 0.03;

export function applyContrastEnhancement(canvas: Canvas, factor: number): void {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const pixelCount = data.length / 4;
  const gray = new Float64Array(pixelCount);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = g;
    sum += g;
  }
  const mean = sum / pixelCount;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = Math.min(255, Math.max(0, mean + (gray[p] - mean) * factor));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);
}

export function findGutterSplit(canvas: Canvas): number | null {
  // Deliberately a separate implementation from tesseract-ocr-provider.ts's
  // own gutter detection rather than importing it - keeps the
  // already-verified, working OCR path completely untouched by this tool.
  // This version is also stricter (see GUTTER_MIN_INK_FRACTION_PER_SIDE
  // below, added after catching a real false-positive here) - the OCR
  // provider's copy doesn't have that same safeguard yet and could
  // theoretically hit the same false-positive on a sufficiently sparse
  // page, worth backporting there too if it ever comes up in practice.
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const brightnessAt = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  };
  const bandStart = Math.floor(width * GUTTER_SEARCH_BAND[0]);
  const bandEnd = Math.ceil(width * GUTTER_SEARCH_BAND[1]);

  // Score each column by its LONGEST CONTIGUOUS run of blank pixels
  // top-to-bottom, not by what fraction of the column is blank in total.
  // This was a real architecture change, not a tuning tweak - looked at
  // how established scan-splitting tools (ScanTailor) solve this exact
  // problem before making it: they detect actual vertical line features
  // (via edge detection + Hough transform) and pick the most central one,
  // rather than treating "gutter" as a proxy for "mostly blank column" the
  // way this file did until now. A full line-detector was more than this
  // needed, but the underlying insight carries over directly: a real book
  // gutter is a genuinely CONTINUOUS physical feature running almost the
  // full height of the page (the spine doesn't stop partway down), which
  // is a fundamentally different thing from "blank most of the time."
  // Aggregate blank fraction can't tell those apart, and that's what was
  // actually behind every distinct failure mode found in this
  // investigation - a stray mark fragmenting a real gutter into two
  // aggregate-blank regions, and a page's own internal index-column gap
  // (not a real page-spread gutter at all) looking similarly blank in
  // aggregate despite having no continuous physical feature behind it.
  // Checked this change directly against every one of those cases before
  // adopting it - the wide-plateau page, the narrow-sharp-peak page, the
  // gradual-ramp page, the spine-shadow page, the stray-mark page, and
  // the index-page false lead - and it got all of them right without the
  // conflicting, hand-tuned patches those individual cases had been
  // accumulating.
  const scores: { x: number; longestRunFraction: number }[] = [];
  let maxScore = 0;
  for (let x = bandStart; x < bandEnd; x++) {
    let longestRun = 0;
    let currentRun = 0;
    for (let y = 0; y < height; y++) {
      if (brightnessAt(x, y) > 200) {
        currentRun++;
        if (currentRun > longestRun) longestRun = currentRun;
      } else {
        currentRun = 0;
      }
    }
    const longestRunFraction = longestRun / height;
    scores.push({ x, longestRunFraction });
    if (longestRunFraction > maxScore) maxScore = longestRunFraction;
  }
  if (maxScore < GUTTER_MIN_BLANK_FRACTION) return null;

  // Real gutters are rarely a single-pixel-wide line at this render scale -
  // they're a wide blank band. Taking the FIRST column that happens to hit
  // the single highest score systematically picks the LEFT EDGE of that
  // band, not its middle - this was the actual bug behind the inflated
  // right-side margins Josh found early in this investigation. Instead:
  // find every column within a small tolerance of the true maximum, group
  // them into contiguous runs (there can be more than one candidate region
  // in the search band), and split at the center of whichever run actually
  // contains the single highest-scoring column - giving both resulting
  // pages a symmetric, natural margin instead of one page getting nearly
  // the whole band tacked onto its edge.
  //
  // Tolerance of 0.05 (5% of page height) was chosen empirically against
  // every distinct real gutter shape found in this investigation - wide
  // plateau, narrow sharp peak, narrow gradual ramp, shadow-darkened, and
  // the two cases that motivated switching to this longest-contiguous-run
  // scoring in the first place - and gave the visually correct split on
  // all of them without needing a different number per shape.
  const tolerance = 0.05;
  const nearMaxXs = scores.filter((s) => s.longestRunFraction >= maxScore - tolerance).map((s) => s.x);
  const peakX = scores.find((s) => s.longestRunFraction === maxScore)!.x;
  const runs: number[][] = [];
  let currentRun: number[] = [];
  for (const x of nearMaxXs) {
    if (currentRun.length === 0 || x === currentRun[currentRun.length - 1] + 1) {
      currentRun.push(x);
    } else {
      runs.push(currentRun);
      currentRun = [x];
    }
  }
  if (currentRun.length > 0) runs.push(currentRun);
  const peakRun = runs.find((run) => run.includes(peakX));
  const longestCandidateRun = runs.reduce((best, run) => (run.length > best.length ? run : best), runs[0]);
  const chosenRun = peakRun ?? longestCandidateRun;
  const splitX = Math.round((chosenRun[0] + chosenRun[chosenRun.length - 1]) / 2);

  // Confirm real content on both sides, sampling every few pixels rather
  // than every single one (this only runs once, on the winning candidate,
  // so the cost is negligible either way, but there's no need for
  // per-pixel precision on a whole-page ink-density check).
  const SAMPLE_STEP = 4;
  let leftInk = 0;
  let leftTotal = 0;
  let rightInk = 0;
  let rightTotal = 0;
  for (let y = 0; y < height; y += SAMPLE_STEP) {
    for (let x = 0; x < splitX; x += SAMPLE_STEP) {
      leftTotal++;
      if (brightnessAt(x, y) <= 200) leftInk++;
    }
    for (let x = splitX; x < width; x += SAMPLE_STEP) {
      rightTotal++;
      if (brightnessAt(x, y) <= 200) rightInk++;
    }
  }
  const leftInkFraction = leftTotal > 0 ? leftInk / leftTotal : 0;
  const rightInkFraction = rightTotal > 0 ? rightInk / rightTotal : 0;
  if (leftInkFraction < GUTTER_MIN_INK_FRACTION_PER_SIDE || rightInkFraction < GUTTER_MIN_INK_FRACTION_PER_SIDE) {
    return null;
  }

  return splitX;
}
