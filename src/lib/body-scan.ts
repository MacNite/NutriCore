import { BODY_LANDMARKS } from "./body-visualization";

/**
 * Optical circumference estimation from two silhouettes.
 *
 * This is deliberately geometry and not a model. A front view gives the breadth
 * of the body at a height; a side view gives its depth at the same height; the
 * circumference of the cross-section through those two axes is an ellipse
 * perimeter. Nothing here is learned, so there is no training population to be
 * outside of and no weights to license - but equally nothing here has been
 * validated against a tape measure, which is why every result carries an
 * interval and the UI never presents one as a measurement.
 *
 * The levels are measured at are `BODY_LANDMARKS`: the same fractions of
 * stature the drawn figure is built from. Sharing them is the point. A scan and
 * the figure it feeds are then answerable to one model of where a waist is,
 * rather than two that can drift apart.
 *
 * Everything in this file is pure. It takes a mask and returns numbers, so the
 * hard part - deciding which pixels are a person - stays in the adapter that
 * can be swapped for a segmentation model later.
 */

/** A binary foreground mask, row-major, one byte per pixel: 1 is the person. */
export interface Silhouette {
  width: number;
  height: number;
  mask: Uint8Array;
}

/** Horizontal extent of the person on one row, in pixels. */
export interface Span {
  /** Leftmost foreground pixel, or null on a row with none. */
  left: number | null;
  right: number | null;
  /** Foreground pixels on the row, which is not `right - left` where limbs separate. */
  filled: number;
  /**
   * Contiguous foreground runs, left to right.
   *
   * Kept because a torso level is not the whole row: arms held away from the
   * body sit either side of it with background between, so the distance from
   * the leftmost pixel to the rightmost is the span of the arms, not the width
   * of the waist. The run through the middle is the torso.
   */
  runs: { start: number; end: number }[];
}

/**
 * What two silhouettes can actually support.
 *
 * The upper arm is deliberately absent. A horizontal line across the arms also
 * crosses the torso, and nothing in a front silhouette says where one stops -
 * the torso width at that level is simply not observable. Inferring it from a
 * level below the armpit fails on any body whose chest is wider than its
 * shoulders, which is most of them. A number that cannot be defended is worse
 * than a missing one, so the arm is left to the tape measure.
 */
export const SCAN_REGIONS = ["neckCm", "chestCm", "waistCm", "hipCm", "thighCm", "calfCm"] as const;
export type ScanRegion = (typeof SCAN_REGIONS)[number];

/**
 * Where each region is measured, as a fraction of stature below the crown.
 *
 * Taken from the drawn figure's landmarks rather than restated, so the level a
 * scan reports a waist at is the level the figure draws one at.
 */
export const REGION_LEVEL: Record<ScanRegion, number> = {
  neckCm: BODY_LANDMARKS.neckBase,
  chestCm: BODY_LANDMARKS.chest,
  waistCm: BODY_LANDMARKS.waist,
  hipCm: BODY_LANDMARKS.hip,
  thighCm: BODY_LANDMARKS.thigh,
  calfCm: BODY_LANDMARKS.calf,
};

/**
 * The level the arms cross the frame at. Not measured - only used to check
 * that they are being held clear of the body.
 */
const ARM_LEVEL = (BODY_LANDMARKS.shoulder + BODY_LANDMARKS.armpit) / 2;

/**
 * Which body parts a level crosses in the front view.
 *
 * A torso level crosses one body; a thigh or calf level crosses two legs, so
 * half the filled width is one limb.
 */
const PAIRED_LIMB: ScanRegion[] = ["thighCm", "calfCm"];

/**
 * Half-width of the interval reported for each region, as a fraction of the
 * value.
 *
 * These are honest guesses about how wrong an uncalibrated silhouette estimate
 * is, not measured limits of agreement, and they are wide on purpose. A waist
 * is a well-defined level on a well-segmented torso and gets the tightest band;
 * a limb whose width is halved out of a row crossing both of them gets a looser
 * one. Replace them with real numbers from a repeatability study before any of
 * this is described as accurate - `docs/BODY_SCAN.md` says so too.
 */
const RELATIVE_UNCERTAINTY: Record<ScanRegion, number> = {
  neckCm: 0.08,
  chestCm: 0.07,
  waistCm: 0.06,
  hipCm: 0.06,
  thighCm: 0.09,
  calfCm: 0.09,
};

/** Reasons a capture is not good enough to estimate from. */
export type ScanQualityReason =
  | "front-empty"
  | "side-empty"
  | "cut-off-top"
  | "cut-off-bottom"
  | "too-small"
  | "off-centre"
  | "background-busy"
  | "height-mismatch"
  | "arms-touching";

export interface ScanQuality {
  accepted: boolean;
  reasons: ScanQualityReason[];
}

export interface EstimatedCircumference {
  region: ScanRegion;
  valueCm: number;
  lowerCm: number;
  upperCm: number;
}

export interface ScanEstimateResult {
  quality: ScanQuality;
  /** Empty whenever quality was rejected: a bad capture yields no numbers at all. */
  measurements: EstimatedCircumference[];
}

/* ------------------------------------------------------------ Mask geometry */

/** Per-row extents. One pass, because every later question is asked of these. */
export function rowSpans(silhouette: Silhouette): Span[] {
  const { width, height, mask } = silhouette;
  const spans: Span[] = [];
  for (let y = 0; y < height; y += 1) {
    let left: number | null = null;
    let right: number | null = null;
    let filled = 0;
    const runs: { start: number; end: number }[] = [];
    let runStart: number | null = null;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (mask[row + x]) {
        if (left === null) left = x;
        right = x;
        filled += 1;
        if (runStart === null) runStart = x;
      } else if (runStart !== null) {
        runs.push({ start: runStart, end: x - 1 });
        runStart = null;
      }
    }
    if (runStart !== null) runs.push({ start: runStart, end: width - 1 });
    spans.push({ left, right, filled, runs });
  }
  return spans;
}

export interface Extent {
  top: number;
  bottom: number;
  /** Stature in pixels, crown to sole inclusive. */
  heightPx: number;
}

/** Vertical extent of the person, or null for a mask with no foreground. */
export function bodyExtent(spans: Span[]): Extent | null {
  const top = spans.findIndex((span) => span.filled > 0);
  if (top === -1) return null;
  let bottom = top;
  for (let y = spans.length - 1; y >= top; y -= 1) {
    if (spans[y].filled > 0) {
      bottom = y;
      break;
    }
  }
  return { top, bottom, heightPx: bottom - top + 1 };
}

/**
 * The row a landmark falls on, as an index into `spans`.
 *
 * Fractions run from the crown, so the sole is 1.0 and the row is simply that
 * far down the extent. Clamped, because a fraction of 1.0 would otherwise index
 * one past the last row.
 */
export function levelRow(extent: Extent, fraction: number): number {
  const row = extent.top + Math.round(fraction * (extent.heightPx - 1));
  return Math.min(Math.max(row, extent.top), extent.bottom);
}

/**
 * Width at a level, smoothed over a band a few rows deep.
 *
 * A single row is at the mercy of one ragged edge in the mask. The median over
 * a band is not, and a body's width changes slowly enough over a centimetre
 * that the smoothing costs nothing real.
 */
export function widthAt(
  spans: Span[],
  row: number,
  bandPx: number,
  use: "extent" | "filled" | "central" = "extent",
): number {
  const half = Math.max(1, Math.round(bandPx / 2));
  const values: number[] = [];
  for (let y = row - half; y <= row + half; y += 1) {
    const span = spans[y];
    if (!span || span.filled === 0) continue;
    if (use === "filled") values.push(span.filled);
    else if (use === "central") values.push(centralRunWidth(span));
    else values.push((span.right ?? 0) - (span.left ?? 0) + 1);
  }
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/**
 * Width of the run through the middle of the body on one row.
 *
 * The torso, on any row an arm also crosses. The midpoint between the leftmost
 * and rightmost pixel is the body's centre line for the symmetric stance the
 * capture instructions ask for; the run containing it is the trunk. Falling
 * back to the widest run keeps a row whose centre lands in a gap - someone
 * standing slightly turned - from reporting nothing.
 */
export function centralRunWidth(span: Span): number {
  if (!span.runs.length) return 0;
  const centre = ((span.left ?? 0) + (span.right ?? 0)) / 2;
  const through = span.runs.find((run) => centre >= run.start && centre <= run.end);
  const chosen = through ?? span.runs.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  return chosen.end - chosen.start + 1;
}

/* --------------------------------------------------------------- Perimeters */

/**
 * Ramanujan's second approximation to an ellipse perimeter.
 *
 * Exact enough that the error is orders of magnitude below anything else here,
 * and it degrades to a circle's circumference when the axes are equal - which
 * matters, because a limb read from two views usually is nearly circular.
 */
export function ellipsePerimeter(semiMajor: number, semiminor: number): number {
  const a = Math.max(semiMajor, semiminor);
  const b = Math.min(semiMajor, semiminor);
  if (a <= 0) return 0;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * Whether the arms are being held clear of the body.
 *
 * Asked of the gap rather than of the width: with the arms out, the row across
 * them contains background between each arm and the torso, so the pixels it
 * actually fills fall short of the distance from the leftmost to the rightmost.
 * With the arms down there is no gap, and the torso reads as wide as the body
 * plus both arms - which silently inflates the chest and the waist. Comparing
 * widths at two levels cannot detect that; a gap can.
 */
export function armsAreClear(spans: Span[], extent: Extent, bandPx: number): boolean {
  const row = levelRow(extent, ARM_LEVEL);
  const across = widthAt(spans, row, bandPx, "extent");
  const filled = widthAt(spans, row, bandPx, "filled");
  if (across <= 0) return false;
  /* A few pixels of ragged edge is not a gap. Two gaps of a finger's width on
     a body a few hundred pixels wide comfortably clears this. */
  return across - filled >= Math.max(4, across * 0.03);
}

/* ------------------------------------------------------------------ Quality */

/**
 * How much of the frame the person has to fill, as a fraction of its height.
 * Below this the mask is too coarse for a centimetre to survive rounding.
 */
const MIN_FRAME_FILL = 0.5;
/** Stature is the scale, so the two views have to agree on it within this. */
const MAX_HEIGHT_MISMATCH = 0.08;
/**
 * A silhouette wider than this fraction of the frame at the waist is a person
 * merged with their background, not a person.
 */
const MAX_WAIST_FILL = 0.6;

/**
 * Whether a capture can be estimated from, and why not when it cannot.
 *
 * Every check is a reason to ask for a retake, which is why they are returned
 * as a list rather than a boolean: "stand further back" and "your feet are cut
 * off" are different instructions and the user deserves the right one.
 */
export function assessCapture(front: Silhouette, side: Silhouette): ScanQuality {
  const reasons: ScanQualityReason[] = [];
  const frontSpans = rowSpans(front);
  const sideSpans = rowSpans(side);
  const frontExtent = bodyExtent(frontSpans);
  const sideExtent = bodyExtent(sideSpans);

  if (!frontExtent) reasons.push("front-empty");
  if (!sideExtent) reasons.push("side-empty");
  if (!frontExtent || !sideExtent) return { accepted: false, reasons };

  /* Touching the frame edge means the body continues outside it, and a stature
     that is not the whole body scales every measurement wrongly. */
  if (frontExtent.top === 0 || sideExtent.top === 0) reasons.push("cut-off-top");
  if (frontExtent.bottom === front.height - 1 || sideExtent.bottom === side.height - 1) reasons.push("cut-off-bottom");

  if (frontExtent.heightPx < front.height * MIN_FRAME_FILL) reasons.push("too-small");

  const frontRatio = frontExtent.heightPx / front.height;
  const sideRatio = sideExtent.heightPx / side.height;
  if (Math.abs(frontRatio - sideRatio) > MAX_HEIGHT_MISMATCH) reasons.push("height-mismatch");

  const waistRow = levelRow(frontExtent, REGION_LEVEL.waistCm);
  const waistWidth = widthAt(frontSpans, waistRow, bandFor(frontExtent), "central");
  if (waistWidth > front.width * MAX_WAIST_FILL) reasons.push("background-busy");

  /* Arms against the body are measured as part of the torso, so a chest and a
     waist read from that capture are wrong in a way no later check would catch. */
  if (!armsAreClear(frontSpans, frontExtent, bandFor(frontExtent))) reasons.push("arms-touching");

  /* The body has to be inside the frame with room on both sides, or a limb is
     being clipped even though the stature looks complete. */
  const waistSpan = frontSpans[waistRow];
  if (waistSpan?.left === 0 || waistSpan?.right === front.width - 1) reasons.push("off-centre");

  return { accepted: reasons.length === 0, reasons };
}

/** Smoothing band: one centimetre of the body, never fewer than three rows. */
const bandFor = (extent: Extent) => Math.max(3, Math.round(extent.heightPx / 170));

/* ----------------------------------------------------------------- Estimate */

export interface ScanInput {
  front: Silhouette;
  side: Silhouette;
  /** Declared stature. The only thing that turns pixels into centimetres. */
  heightCm: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Circumferences for every region the two views support.
 *
 * A rejected capture returns no measurements at all. Returning the numbers
 * anyway, marked poor, invites exactly the thing this feature must not do:
 * someone accepting a value the system already said it did not believe.
 */
export function estimateCircumferences(input: ScanInput): ScanEstimateResult {
  const quality = assessCapture(input.front, input.side);
  if (!quality.accepted) return { quality, measurements: [] };

  const frontSpans = rowSpans(input.front);
  const sideSpans = rowSpans(input.side);
  const frontExtent = bodyExtent(frontSpans)!;
  const sideExtent = bodyExtent(sideSpans)!;

  /* Each view has its own scale: the person is rarely the same distance from
     the camera twice, and stature is what both are normalised against. */
  const frontCmPerPx = input.heightCm / frontExtent.heightPx;
  const sideCmPerPx = input.heightCm / sideExtent.heightPx;
  const frontBand = bandFor(frontExtent);
  const sideBand = bandFor(sideExtent);

  const measurements: EstimatedCircumference[] = [];

  for (const region of SCAN_REGIONS) {
    const level = REGION_LEVEL[region];
    const paired = PAIRED_LIMB.includes(region);
    /* A leg level crosses two legs, so `filled` counts both and excludes the
       gap between them. A torso level may also be crossed by the arms, so it
       takes the run through the middle and leaves them out. */
    const frontPx = widthAt(frontSpans, levelRow(frontExtent, level), frontBand, paired ? "filled" : "central");
    const breadthCm = (paired ? frontPx / 2 : frontPx) * frontCmPerPx;
    /* Both legs are in line in a side view, so its depth is one leg's. */
    const sidePx = widthAt(sideSpans, levelRow(sideExtent, level), sideBand, "central");
    const depthCm = sidePx * sideCmPerPx;

    if (breadthCm <= 0 || depthCm <= 0) continue;

    const value = ellipsePerimeter(breadthCm / 2, depthCm / 2);
    const margin = value * RELATIVE_UNCERTAINTY[region];
    measurements.push({
      region,
      valueCm: round1(value),
      lowerCm: round1(value - margin),
      upperCm: round1(value + margin),
    });
  }

  return { quality, measurements };
}

/**
 * How a scan region lands in a `BodyMeasurement`.
 *
 * The scan cannot tell left from right - a front view shows both legs and
 * nothing in a silhouette says which is which - so a paired region fills both
 * columns with the same number. That is a real limitation and the review screen
 * says as much rather than implying two independent measurements.
 */
export const REGION_FIELDS: Record<ScanRegion, readonly string[]> = {
  neckCm: ["neckCm"],
  chestCm: ["chestCm"],
  waistCm: ["waistCm"],
  hipCm: ["hipCm"],
  thighCm: ["thighLeftCm", "thighRightCm"],
  calfCm: ["calfLeftCm", "calfRightCm"],
};
