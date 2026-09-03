import { ARM_SEGMENT, BODY_LANDMARKS } from "./body-visualization";

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
 * Above the shoulder line nothing but head, neck and shoulders crosses a row.
 * A level there is readable whatever the arms are doing.
 */
const SHOULDER_LEVEL = BODY_LANDMARKS.shoulder;

/**
 * The lowest level a hand can reach: the shoulder plus a whole arm hanging
 * straight down. Below it no arm can cross a row, however it is held.
 *
 * The segments are the drawn figure's, for the same reason the levels are - one
 * model of where an arm reaches to, rather than two that can drift apart.
 */
const ARM_REACH_LEVEL = BODY_LANDMARKS.shoulder + ARM_SEGMENT.upper + ARM_SEGMENT.fore + ARM_SEGMENT.hand;

/**
 * The background gap an arm has to leave beside the trunk, as a fraction of
 * stature.
 *
 * Relative to the body rather than to the frame, so it means the same thing at
 * every resolution and camera distance: about a centimetre on a 176 cm body. A
 * ragged mask edge cannot fake that, and a hand's breadth of real clearance
 * clears it several times over.
 */
const MIN_ARM_GAP = 0.005;

/**
 * How much wider than the chest the shoulder line has to be before the arms are
 * read as held out and up, clear of every torso level below them.
 *
 * An outstretched arm span is four to five times a chest breadth. No trunk
 * comes near 1.5, so this separates a T-pose from a stance without needing to
 * find the arms in the mask at all.
 */
const ARMS_RAISED_RATIO = 1.5;

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
  | "arms-touching"
  /* One level the arms cross, rather than a capture that cannot be used. Every
     other level is still measured; only this one is left out. */
  | "arm-obscured-neck"
  | "arm-obscured-chest"
  | "arm-obscured-waist"
  | "arm-obscured-hip"
  | "arm-obscured-thigh"
  | "arm-obscured-calf";

/** Which reason names a level the arms made unreadable. */
const OBSCURED_REASON: Record<ScanRegion, ScanQualityReason> = {
  neckCm: "arm-obscured-neck",
  chestCm: "arm-obscured-chest",
  waistCm: "arm-obscured-waist",
  hipCm: "arm-obscured-hip",
  thighCm: "arm-obscured-thigh",
  calfCm: "arm-obscured-calf",
};

/**
 * Reasons that leave the rest of the capture usable.
 *
 * A level the arms cross is a missing row, not a bad photograph: the remaining
 * levels were read from the same mask and are no less trustworthy for it. So it
 * is reported and the scan is still accepted, where every other reason means
 * there is nothing to accept.
 */
const isAdvisory = (reason: ScanQualityReason) => reason.startsWith("arm-obscured-");

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
export function centralRun(span: Span): { start: number; end: number } | null {
  if (!span.runs.length) return null;
  const centre = ((span.left ?? 0) + (span.right ?? 0)) / 2;
  const through = span.runs.find((run) => centre >= run.start && centre <= run.end);
  return through ?? span.runs.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
}

export function centralRunWidth(span: Span): number {
  const run = centralRun(span);
  return run ? run.end - run.start + 1 : 0;
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

/* ---------------------------------------------------------- Arm interference */

export interface ArmClearance {
  /** Levels the arms merge into, whose width is therefore not observable. */
  obscured: ScanRegion[];
  /** Whether the arms are held out and up, clear of every torso level below. */
  raised: boolean;
}

/**
 * Whether one row shows each arm standing clear of the trunk.
 *
 * Asked of the background gap either side of the trunk run, because a gap is
 * the only thing in a silhouette that says where an arm ends and a torso
 * begins. It is the real clearance - from the arm's inner edge to the trunk -
 * and not a distance between silhouette extremes, which is the arm span and
 * grows when the arms come *down*.
 */
function armsClearOn(span: Span, minGap: number): boolean {
  /* Arm, trunk, arm. Fewer runs means at least one arm is fused to the body. */
  if (span.runs.length < 3) return false;
  const trunk = centralRun(span);
  if (!trunk) return false;
  const index = span.runs.indexOf(trunk);
  const left = span.runs[index - 1];
  const right = span.runs[index + 1];
  if (!left || !right) return false;
  return trunk.start - left.end - 1 >= minGap && right.start - trunk.end - 1 >= minGap;
}

/** Median run count over a band, so one ragged row cannot decide a level. */
function runCountAt(spans: Span[], row: number, bandPx: number): number {
  const half = Math.max(1, Math.round(bandPx / 2));
  const counts: number[] = [];
  for (let y = row - half; y <= row + half; y += 1) {
    const span = spans[y];
    if (!span || span.filled === 0) continue;
    counts.push(span.runs.length);
  }
  if (!counts.length) return 0;
  counts.sort((a, b) => a - b);
  return counts[Math.floor(counts.length / 2)];
}

/** Whether the arms stand clear on most of a band of rows, not just on one. */
function armsClearAt(spans: Span[], row: number, bandPx: number, minGap: number): boolean {
  const half = Math.max(1, Math.round(bandPx / 2));
  let clear = 0;
  let rows = 0;
  for (let y = row - half; y <= row + half; y += 1) {
    const span = spans[y];
    if (!span || span.filled === 0) continue;
    rows += 1;
    if (armsClearOn(span, minGap)) clear += 1;
  }
  return rows > 0 && clear * 2 > rows;
}

/**
 * Which levels the arms make unreadable, and which they leave alone.
 *
 * This used to be one boolean asked at one row halfway between the shoulder and
 * the armpit - and that row is *above* the armpit, where an arm is joined to
 * the deltoid at any pose short of holding it out horizontally. So the only
 * stance that ever passed was an exaggerated T-pose, and a natural one with the
 * arms visibly clear of the body was rejected as "arms touching". A perfect
 * T-pose failed too, because arms held level leave that row entirely and it
 * reads as a bare torso.
 *
 * The question belongs at each level that is actually measured, because that is
 * where interference does its damage, and it has three separate answers:
 *
 * - a level above the shoulder or below a whole arm's reach has no arm on it,
 *   whatever the pose;
 * - arms held out and up clear every torso level below them at once, which is
 *   the T-pose, recognised from the shoulder line being far wider than the
 *   chest rather than from finding the arms in the mask;
 * - otherwise the level needs a real gap either side of its trunk run.
 *
 * With the arms hanging a few degrees out, the hip and the waist have that gap
 * and the chest does not - the upper arm is still against the ribcage there.
 * Reporting that one level as unreadable is the honest answer, and it is what
 * this returns instead of throwing the whole capture away.
 */
/**
 * Where the arms are visibly clear of the trunk, as a row range.
 *
 * An arm leaves the shoulder fused to the deltoid, comes away from the body
 * somewhere below the armpit, and ends at the fingertips. So the rows on which
 * a gap is visible bound the arm from both sides: above the first of them the
 * arm is merged into the trunk, and below the last of them there is no arm left
 * to interfere with anything.
 *
 * That lower bound has to be read from the mask rather than assumed. An arm
 * held out reaches a good deal less far down than one hanging straight, and
 * taking a whole arm's length as the reach would demand a gap on rows the arms
 * never touch - which is how a level below the fingertips ends up reported as
 * obscured by them.
 *
 * A run of qualifying rows has to be at least a smoothing band deep, so a
 * couple of ragged rows in the mask cannot invent an arm or lose one.
 */
function separationBand(
  spans: Span[],
  extent: Extent,
  bandPx: number,
  minGap: number,
): { first: number; last: number } | null {
  const top = levelRow(extent, SHOULDER_LEVEL) + 1;
  const bottom = levelRow(extent, ARM_REACH_LEVEL);
  let first: number | null = null;
  let last: number | null = null;
  let runStart: number | null = null;

  const close = (end: number) => {
    if (runStart === null) return;
    if (end - runStart + 1 >= bandPx) {
      if (first === null) first = runStart;
      last = end;
    }
    runStart = null;
  };

  for (let row = top; row <= bottom; row += 1) {
    const span = spans[row];
    if (span && span.filled > 0 && armsClearOn(span, minGap)) {
      if (runStart === null) runStart = row;
    } else {
      close(row - 1);
    }
  }
  close(bottom);

  return first === null || last === null ? null : { first, last };
}

export function armClearance(spans: Span[], extent: Extent, bandPx: number): ArmClearance {
  const minGap = Math.max(2, Math.round(extent.heightPx * MIN_ARM_GAP));
  const shoulderRow = levelRow(extent, SHOULDER_LEVEL);
  const reachRow = levelRow(extent, ARM_REACH_LEVEL);

  const shoulderSpan = widthAt(spans, shoulderRow, bandPx, "extent");
  const chestSpan = widthAt(spans, levelRow(extent, REGION_LEVEL.chestCm), bandPx, "extent");
  const raised = chestSpan > 0 && shoulderSpan >= chestSpan * ARMS_RAISED_RATIO;
  const band = separationBand(spans, extent, bandPx, minGap);

  const obscured: ScanRegion[] = [];
  for (const region of SCAN_REGIONS) {
    const row = levelRow(extent, REGION_LEVEL[region]);
    /* Above the shoulder or below a whole arm's reach, no pose puts an arm on
       this row. Nothing to check. */
    if (row <= shoulderRow || row > reachRow) continue;

    if (PAIRED_LIMB.includes(region)) {
      /* A leg level is read from the filled pixel count halved, so a hand
         hanging beside a thigh is counted as thigh. Two runs is two legs and
         nothing else; more than that means something extra crosses the row.
         Checked whatever the arms are doing, because the damage here is done by
         a hand that never comes near the trunk. */
      if (runCountAt(spans, row, bandPx) > 2) obscured.push(region);
      continue;
    }

    /* Arms held out and up are clear of every torso level below them at once. */
    if (raised) continue;
    /* No gap anywhere: the arms are flat against the body from the shoulder
       down, and no torso level within their reach is observable. */
    if (!band) {
      obscured.push(region);
      continue;
    }
    /* Past the lowest row a gap was seen on, the arms have ended. */
    if (row > band.last) continue;
    /* Between the shoulder and the first gap the arm is still fused to the
       trunk, and in between it has to show the gap on this row itself - an arm
       bent back against the waist is merged there however clear it is lower. */
    if (row < band.first || !armsClearAt(spans, row, bandPx, minGap)) obscured.push(region);
  }
  return { obscured, raised };
}

/**
 * Torso levels an arm can reach, and the ones a capture is worth keeping for.
 *
 * All three unreadable means the arms are flat against the body: there is no
 * trunk width anywhere in the front view and nothing to salvage, which is the
 * one case that still rejects the whole capture.
 */
const REACHABLE_TORSO: ScanRegion[] = ["chestCm", "waistCm", "hipCm"];

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
interface Analysis {
  quality: ScanQuality;
  frontSpans: Span[];
  sideSpans: Span[];
  frontExtent: Extent | null;
  sideExtent: Extent | null;
  /** Levels left out of the estimate because the arms cross them. */
  obscured: ScanRegion[];
}

/**
 * One pass over both masks, because the quality checks and the estimate ask the
 * same questions of them.
 *
 * Row spans used to be built twice for each view - once to assess the capture
 * and again to measure it - and, worse, the two could disagree about which
 * levels the arms had spoiled. Sharing the pass makes that impossible.
 */
function analyse(front: Silhouette, side: Silhouette): Analysis {
  const reasons: ScanQualityReason[] = [];
  const frontSpans = rowSpans(front);
  const sideSpans = rowSpans(side);
  const frontExtent = bodyExtent(frontSpans);
  const sideExtent = bodyExtent(sideSpans);
  const empty = { frontSpans, sideSpans, frontExtent, sideExtent, obscured: [] as ScanRegion[] };

  if (!frontExtent) reasons.push("front-empty");
  if (!sideExtent) reasons.push("side-empty");
  if (!frontExtent || !sideExtent) return { ...empty, quality: { accepted: false, reasons } };

  /* Touching the frame edge means the body continues outside it, and a stature
     that is not the whole body scales every measurement wrongly. */
  if (frontExtent.top === 0 || sideExtent.top === 0) reasons.push("cut-off-top");
  if (frontExtent.bottom === front.height - 1 || sideExtent.bottom === side.height - 1) reasons.push("cut-off-bottom");

  if (frontExtent.heightPx < front.height * MIN_FRAME_FILL) reasons.push("too-small");

  const frontRatio = frontExtent.heightPx / front.height;
  const sideRatio = sideExtent.heightPx / side.height;
  if (Math.abs(frontRatio - sideRatio) > MAX_HEIGHT_MISMATCH) reasons.push("height-mismatch");

  const frontBand = bandFor(frontExtent);
  const waistRow = levelRow(frontExtent, REGION_LEVEL.waistCm);
  const waistWidth = widthAt(frontSpans, waistRow, frontBand, "central");
  if (waistWidth > front.width * MAX_WAIST_FILL) reasons.push("background-busy");

  /* An arm merged into the trunk is measured as part of it, so a level it
     crosses is wrong in a way no later check would catch. Which levels those
     are is decided once here and honoured by the estimate below. */
  const clearance = armClearance(frontSpans, frontExtent, frontBand);
  const torsoObscured = REACHABLE_TORSO.filter((region) => clearance.obscured.includes(region));
  let obscured = clearance.obscured;
  if (torsoObscured.length === REACHABLE_TORSO.length) {
    /* Nothing measurable across the trunk at all: the arms are flat against the
       body and the whole capture has to be retaken. Reported as the one reason
       it is, rather than as a list of every level it cost. */
    reasons.push("arms-touching");
    obscured = [];
  } else {
    for (const region of clearance.obscured) reasons.push(OBSCURED_REASON[region]);
  }

  /* The body has to be inside the frame with room on both sides, or a limb is
     being clipped even though the stature looks complete. */
  const waistSpan = frontSpans[waistRow];
  if (waistSpan?.left === 0 || waistSpan?.right === front.width - 1) reasons.push("off-centre");

  return {
    frontSpans,
    sideSpans,
    frontExtent,
    sideExtent,
    obscured,
    quality: { accepted: !reasons.some((reason) => !isAdvisory(reason)), reasons },
  };
}

export function assessCapture(front: Silhouette, side: Silhouette): ScanQuality {
  return analyse(front, side).quality;
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
  const { quality, frontSpans, sideSpans, frontExtent, sideExtent, obscured } = analyse(input.front, input.side);
  if (!quality.accepted || !frontExtent || !sideExtent) return { quality, measurements: [] };

  /* Each view has its own scale: the person is rarely the same distance from
     the camera twice, and stature is what both are normalised against. */
  const frontCmPerPx = input.heightCm / frontExtent.heightPx;
  const sideCmPerPx = input.heightCm / sideExtent.heightPx;
  const frontBand = bandFor(frontExtent);
  const sideBand = bandFor(sideExtent);

  const measurements: EstimatedCircumference[] = [];

  for (const region of SCAN_REGIONS) {
    /* A level the arms cross is left out rather than estimated wrongly. The
       reason travelled out with `quality`, so the review screen can say which
       one is missing and why. */
    if (obscured.includes(region)) continue;
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
