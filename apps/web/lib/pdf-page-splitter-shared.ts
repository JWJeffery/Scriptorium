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
const GUTTER_MIN_BLANK_FRACTION = 0.75;
// Originally 0.9, lowered after finding a real page this missed: a
// genuine two-page spread whose gutter shows visible shadowing from the
// physical curvature of the book near its spine (confirmed directly by
// visual inspection of the source scan), not text - the shadow darkens
// the gutter just enough that it stops counting as "blank" under the
// stricter threshold, even though there's no real content there. Checked
// the full real 64-page book directly before picking a new number: every
// other page's true gutter measures 0.9157 or higher, and this one
// measures 0.8036 - a clear, isolated outlier, not a page sitting right
// at a fuzzy boundary. 0.75 sits with real margin below the outlier and
// even more below everything else, while the separate ink-density check
// immediately below remains the actual safeguard against false positives
// on genuine single-column pages - lowering this threshold doesn't weaken
// that safeguard, which doesn't depend on it.
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
  const fractions: { x: number; fraction: number }[] = [];
  let maxFraction = 0;
  for (let x = bandStart; x < bandEnd; x++) {
    let blankCount = 0;
    for (let y = 0; y < height; y++) {
      if (brightnessAt(x, y) > 200) blankCount++;
    }
    const fraction = blankCount / height;
    fractions.push({ x, fraction });
    if (fraction > maxFraction) maxFraction = fraction;
  }
  if (maxFraction < GUTTER_MIN_BLANK_FRACTION) return null;

  // Real gutters are rarely a single-pixel-wide line at this render scale -
  // they're a wide blank band (confirmed directly against a real page:
  // 362px wide, on a page rendered at ~1520px total width). Taking the
  // FIRST column that happens to hit the single highest blank fraction
  // systematically picks the LEFT EDGE of that band, not its middle -
  // this was the actual bug behind the inflated right-side margins Josh
  // found, confirmed by direct diagnostic (leftmost qualifying column at
  // x=456, true center of the same blank band at x=637, a 181px/12%-of-
  // page-width difference). Instead: find every column within a small
  // tolerance of the true maximum, group them into contiguous runs (there
  // can be more than one blank-ish region in the search band), and split
  // at the center of whichever run actually contains the single highest-
  // scoring column - giving both resulting pages a symmetric, natural
  // margin instead of one page getting nearly the whole blank band tacked
  // onto its edge.
  //
  // On dense body-text pages, the real gutter can be genuinely narrow and
  // there can be a second, unrelated near-max region elsewhere in the
  // search band (confirmed directly on a real page: two separate 3px
  // regions 26px apart, both technically tied for "longest run" -
  // choosing whichever the scan happened to reach first picked the wrong
  // one on that real page and caused a real split failure). The single
  // highest-scoring column is unambiguous even when multiple candidate
  // regions tie on length, so using "which run contains the true peak" to
  // choose between them is deterministic where "longest run, first found"
  // was not.
  //
  // Tolerance around the peak was originally 0.01 (a "flat top only"
  // reading), which broke on a real page whose gutter isn't a flat
  // plateau but a gradual ramp - blank fraction climbs from ~0.82 near
  // the edges of the gutter to a ~0.99 peak over about 25-30px on each
  // side. 0.01 only captured the flat top of that ramp (a 29px span,
  // missing its real shoulders), landing the split 13px off the gutter's
  // true visual center - confirmed directly: text on the cropped output
  // page sat almost flush against the crop edge on one side. Widened to
  // 0.15 to capture those shoulders. Checked this doesn't regress the
  // cases that motivated the narrower number in the first place: the
  // wide-plateau page's computed center didn't move at all going from
  // 0.01 to 0.15 (the plateau's falloff outside the true gutter is sharp
  // enough that a wider relative tolerance doesn't reach past it), and
  // the narrow-sharp-peak page's span only grew by a few pixels, still
  // landing centered on the same peak.
  const tolerance = 0.15;
  const nearMaxXs = fractions.filter((f) => f.fraction >= maxFraction - tolerance).map((f) => f.x);
  const peakX = fractions.find((f) => f.fraction === maxFraction)!.x;
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
  const longestRun = runs.reduce((best, run) => (run.length > best.length ? run : best), runs[0]);
  const chosenRun = peakRun ?? longestRun;
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
