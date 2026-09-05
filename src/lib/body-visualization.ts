import { BODY_METRICS, type BodyMeasurement, type BodyMetricKey } from "./body-metrics";

/**
 * Geometry for the two body-progress visualisations: the four-axis composition
 * diamond and the schematic body outline. Kept out of the components so the
 * shapes can be reasoned about (and tested) as plain numbers.
 */

/* ------------------------------------------------------------------ Diamond */

export type CompositionAxisKey = "muscle" | "water" | "fat" | "bone";

export interface CompositionAxis {
  key: CompositionAxisKey;
  /** Screen angle: -90 is up, 0 is right, 90 is down, 180 is left. */
  angleDeg: number;
}

/** Muscle on top, water right, fat bottom, bone left — a fixed character-sheet order. */
export const COMPOSITION_AXES: CompositionAxis[] = [
  { key: "muscle", angleDeg: -90 },
  { key: "water", angleDeg: 0 },
  { key: "fat", angleDeg: 90 },
  { key: "bone", angleDeg: 180 },
];

export const DIAMOND = {
  /* Wider than tall: the left and right axis labels need horizontal room. */
  width: 380,
  height: 320,
  cx: 190,
  cy: 160,
  /** Radius that represents the reference value on every axis. */
  baseRadius: 78,
  /** Pixels gained per 1.0 of ratio, i.e. per 100 % change. */
  pxPerRatio: 300,
  minRadius: 26,
  maxRadius: 112,
} as const;

/** Rings drawn behind the polygons, as ratios of the reference value. */
export const DIAMOND_RINGS = [0.9, 1.1] as const;

/**
 * Each axis is normalised against its own reference value, so radius 78 always
 * means "unchanged". Change is amplified because a realistic body moves by a
 * few percent: an unamplified diamond would look identical every week.
 */
export function radiusForRatio(ratio: number): number {
  const radius = DIAMOND.baseRadius + (ratio - 1) * DIAMOND.pxPerRatio;
  return Math.min(DIAMOND.maxRadius, Math.max(DIAMOND.minRadius, radius));
}

export interface Point {
  x: number;
  y: number;
}

export function polarPoint(angleDeg: number, radius: number): Point {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: DIAMOND.cx + Math.cos(radians) * radius,
    y: DIAMOND.cy + Math.sin(radians) * radius,
  };
}

export const polygonPoints = (points: Point[]) =>
  points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");

/**
 * Ratio of a current value to its reference, or null when the axis cannot be
 * compared at all.
 *
 * A missing value used to come back as 1, which put the vertex exactly on the
 * reference ring: a session that measured nothing was drawn as a complete,
 * perfectly unchanged body. Unknown and unchanged are not the same claim, so
 * an axis with nothing behind it now has no point to plot.
 */
export function axisRatio(current: number | null, reference: number | null): number | null {
  if (current == null || reference == null || reference === 0) return null;
  return current / reference;
}

/* ------------------------------------------------------------- Body outline */

/**
 * The drawn body is built on published anthropometry rather than on eyeballed
 * offsets: every vertical landmark below is a fraction of stature from the
 * crown (Drillis & Contini's segment lengths as reproduced in Winter,
 * *Biomechanics and Motor Control of Human Movement*, Fig. 4.1), which puts the
 * figure at the 7.5-head canon with the crotch at the midpoint of the body.
 */
export const BODY_VIEW = { width: 380, height: 480, cx: 190 } as const;

/**
 * The measure figure is the same body with its arms further out and a column
 * of labels beside it, so it needs the room the silhouette does not.
 */
export const MEASURE_VIEW = { width: 470, height: 480, cx: 190, labelX: 342 } as const;

const CROWN = 14;
const STATURE = 452;

/**
 * Landmark heights as fractions of stature, measured down from the crown.
 * Exported because they are the model the drawing is answerable to: a change
 * here is a claim about anatomy, not a nudge to make a curve look nicer.
 */
export const BODY_LANDMARKS = {
  chin: 0.13,
  neckBase: 0.158,
  shoulder: 0.183,
  armpit: 0.238,
  chest: 0.28,
  underbust: 0.318,
  waist: 0.38,
  navel: 0.407,
  hip: 0.478,
  crotch: 0.515,
  thigh: 0.6,
  knee: 0.715,
  calf: 0.795,
  ankle: 0.955,
  sole: 1,
} as const;

/** The same landmarks in view units, which is what every shape is drawn from. */
const Y = Object.fromEntries(
  Object.entries(BODY_LANDMARKS).map(([key, fraction]) => [key, CROWN + fraction * STATURE]),
) as Record<keyof typeof BODY_LANDMARKS, number>;

const HEAD_HEIGHT = BODY_LANDMARKS.chin * STATURE;
/** A front-view head is three quarters as wide as it is tall. */
const HEAD_HALF = (HEAD_HEIGHT * 0.75) / 2;
const HEAD_RY = HEAD_HEIGHT / 2;
/** Where the skull arc gives way to the neck, in degrees from the crown. */
const SKULL_END_DEG = 140;

/** Arm segments along their own axis, again as fractions of stature. */
export const ARM_SEGMENT = { upper: 0.186, fore: 0.146, hand: 0.108 } as const;

/**
 * The figure is drawn for a body of this height. Someone taller or shorter is
 * still drawn at the same size on screen — the drawing compares a body with
 * itself over time, not with anybody else.
 */
const REFERENCE_HEIGHT_CM = 176;
const PX_PER_CM = STATURE / REFERENCE_HEIGHT_CM;

/**
 * A circumference becomes a breadth through the cross-section of that body
 * part. Pairing measured circumferences with measured breadths puts every one
 * of them close to a circle: a torso is flatter than a cylinder, but nowhere
 * near as flat as the ellipse this used to assume.
 */
const CROSS_SECTION = {
  neck: 3.15,
  chest: 3.1,
  waist: 2.95,
  hip: 3.0,
  arm: 3.15,
  thigh: 3.15,
  calf: 3.2,
} as const;

const halfWidth = (circumferenceCm: number, ratio: number) => ((circumferenceCm / ratio) / 2) * PX_PER_CM;

/**
 * A build for the drawn figure. Both halves are the reader's own choice: the
 * somatotype is never inferred from their measurements and never enters a
 * calculation, and the presentation is separate from the profile's
 * `biologicalSex`, which is a clinical input to the energy and RFM formulas.
 */
export type BodyType = "ECTOMORPH" | "MESOMORPH" | "ENDOMORPH";
export type BodyFigure = "NEUTRAL" | "MASCULINE" | "FEMININE";

/**
 * How the shape panel draws that body. The silhouette carries change as tinted
 * bands over the figure; the measure figure holds its arms clear and puts a
 * caliper across each measured level instead. Same geometry, same numbers.
 */
export type BodyShapeStyle = "SILHOUETTE" | "MEASURE";

export interface BodyAppearance {
  type: BodyType;
  figure: BodyFigure;
}

export const BODY_TYPES: BodyType[] = ["ECTOMORPH", "MESOMORPH", "ENDOMORPH"];
export const BODY_FIGURES: BodyFigure[] = ["NEUTRAL", "MASCULINE", "FEMININE"];
export const BODY_SHAPE_STYLES: BodyShapeStyle[] = ["SILHOUETTE", "MEASURE"];

/** Used until someone picks, and for anyone who never does. */
export const DEFAULT_APPEARANCE: BodyAppearance = { type: "MESOMORPH", figure: "NEUTRAL" };
export const DEFAULT_SHAPE_STYLE: BodyShapeStyle = "SILHOUETTE";

/**
 * How far the arms hang away from the body. The silhouette needs only enough
 * clearance to show the waist it is drawn to show; the measure figure needs
 * room for a caliper to cross the body without touching an arm.
 */
const ARM_DEG: Record<BodyShapeStyle, number> = { SILHOUETTE: 10, MEASURE: 22 };

/**
 * Which of the two visualisations a reader wants to see. They are a display
 * preference, not a data one: hiding a panel never stops a value being
 * recorded or exported.
 */
export interface BodyPanels {
  composition: boolean;
  shape: boolean;
}

/** Both on, for everyone who never opens the setting. */
export const DEFAULT_PANELS: BodyPanels = { composition: true, shape: true };

/** Whether any of the body-progress section is left to show. */
export const anyPanel = (panels: BodyPanels) => panels.composition || panels.shape;

/**
 * Which switch each recorded metric answers to. The four composition values are
 * the diamond's own axes; the circumferences are what the outline and the
 * regional heatmap are drawn from, and what the waist-based key figures below
 * the card are derived from.
 *
 * Weight answers to neither. It has its own card further down the progress page
 * and is recorded from three other screens, so it is never what these switches
 * are about.
 */
export const METRIC_PANEL: Record<BodyMetricKey, keyof BodyPanels | null> = {
  weightKg: null,
  neckCm: "shape",
  chestCm: "shape",
  waistCm: "shape",
  hipCm: "shape",
  upperArmCm: "shape",
  thighCm: "shape",
  calfCm: "shape",
  bodyFatPct: "composition",
  muscleKg: "composition",
  bodyWaterPct: "composition",
  boneKg: "composition",
};

/**
 * The metrics worth listing for a given pair of switches, in catalogue order.
 *
 * Weight rides along for as long as the section exists at all: it is the value
 * every other reading is understood against, and a history of circumferences
 * with no weight beside them is harder to read, not tidier. With both switches
 * off nothing is left - the section goes, weight included, and the weight card
 * below it keeps the entries themselves.
 */
export function panelMetrics(panels: BodyPanels): BodyMetricKey[] {
  if (!anyPanel(panels)) return [];
  return BODY_METRICS.filter(({ key }) => {
    const owner = METRIC_PANEL[key];
    return owner === null || panels[owner];
  }).map(({ key }) => key);
}

export interface BodyOutlineInput {
  neckCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  upperArmCm: number;
  thighCm: number;
  calfCm: number;
}

/** Circumferences of an average adult build, in centimetres, per presentation. */
const FIGURE_BASE: Record<BodyFigure, BodyOutlineInput> = {
  MASCULINE: { neckCm: 38, chestCm: 100, waistCm: 85, hipCm: 98, upperArmCm: 32, thighCm: 56, calfCm: 38 },
  FEMININE: { neckCm: 33, chestCm: 90, waistCm: 74, hipCm: 100, upperArmCm: 28, thighCm: 55, calfCm: 35 },
  NEUTRAL: { neckCm: 35, chestCm: 95, waistCm: 79, hipCm: 99, upperArmCm: 30, thighCm: 55, calfCm: 36 },
};

/** How each somatotype departs from that build. Proportions, not judgements. */
const TYPE_SCALE: Record<BodyType, Record<keyof BodyOutlineInput, number>> = {
  ECTOMORPH: { neckCm: 0.94, chestCm: 0.92, waistCm: 0.86, hipCm: 0.92, upperArmCm: 0.86, thighCm: 0.9, calfCm: 0.92 },
  MESOMORPH: { neckCm: 1.04, chestCm: 1.05, waistCm: 0.94, hipCm: 0.98, upperArmCm: 1.1, thighCm: 1.06, calfCm: 1.06 },
  ENDOMORPH: { neckCm: 1.06, chestCm: 1.08, waistCm: 1.2, hipCm: 1.1, upperArmCm: 1.06, thighCm: 1.1, calfCm: 1.04 },
};

/**
 * Shoulder span as a fraction of stature — the one proportion no tape measure
 * on the check-in form reaches, so it belongs to the chosen build rather than
 * to the measurements. Anthropometry puts a biacromial breadth near 0.245 H;
 * the drawn deltoid sits a little wider still.
 */
const SHOULDER_SPAN: Record<BodyType, number> = {
  ECTOMORPH: 0.236,
  MESOMORPH: 0.255,
  ENDOMORPH: 0.246,
};

const FIGURE_SHOULDER: Record<BodyFigure, number> = { MASCULINE: 1.055, NEUTRAL: 1, FEMININE: 0.92 };

/** The build a somatotype describes, with nothing measured. */
export function baselineInput(appearance: BodyAppearance): BodyOutlineInput {
  const base = FIGURE_BASE[appearance.figure];
  const scale = TYPE_SCALE[appearance.type];
  return {
    neckCm: base.neckCm * scale.neckCm,
    chestCm: base.chestCm * scale.chestCm,
    waistCm: base.waistCm * scale.waistCm,
    hipCm: base.hipCm * scale.hipCm,
    upperArmCm: base.upperArmCm * scale.upperArmCm,
    thighCm: base.thighCm * scale.thighCm,
    calfCm: base.calfCm * scale.calfCm,
  };
}

const pair = (left: number | null, right: number | null) => {
  const sides = [left, right].filter((value): value is number => value != null);
  return sides.length === 0 ? null : sides.reduce((sum, value) => sum + value, 0) / sides.length;
};

/**
 * Widths for the drawing. A recorded circumference always wins; the chosen
 * build only fills what has never been measured, so the figure is never blank
 * and never invents a number over one the reader gave it.
 */
export function outlineInput(measurement: BodyMeasurement, appearance: BodyAppearance): BodyOutlineInput {
  const base = baselineInput(appearance);
  return {
    neckCm: measurement.neckCm ?? base.neckCm,
    chestCm: measurement.chestCm ?? base.chestCm,
    waistCm: measurement.waistCm ?? base.waistCm,
    hipCm: measurement.hipCm ?? base.hipCm,
    upperArmCm: pair(measurement.upperArmLeftCm, measurement.upperArmRightCm) ?? base.upperArmCm,
    thighCm: pair(measurement.thighLeftCm, measurement.thighRightCm) ?? base.thighCm,
    calfCm: pair(measurement.calfLeftCm, measurement.calfRightCm) ?? base.calfCm,
  };
}

export interface BodyOutline {
  /**
   * The whole figure as one closed path — head, neck, arms, torso and legs.
   * Drawing it in one piece is what keeps the arms attached at the shoulder
   * with no seam across them; the skull is a true arc at both ends of it.
   */
  silhouette: string;
  /** Torso, head and legs, without arms. Used only to clip the change bands. */
  torso: string;
  /** The arms alone, same purpose. Neither is ever drawn. */
  arms: [string, string];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which group of shapes a region's band is clipped to when it is painted. */
export type BodyClipGroup = "body" | "arms";

export interface BodyRegionGeometry {
  key: BodyRegionKey;
  clip: BodyClipGroup;
  /**
   * Painted bands. Clipping to the group means an arm band can span a whole
   * half of the drawing without ever tinting the torso beside it.
   */
  rects: Rect[];
  /** Pointer targets. Unclipped, mutually disjoint, and easy to hit. */
  hitRects: Rect[];
  /** Anchor of the delta callout beside the figure. */
  label: { x: number; y: number; anchor: "start" | "end" };
}

export type BodyRegionKey = "neck" | "chest" | "waist" | "hip" | "upperArm" | "thigh" | "calf";

/** Top-to-bottom, the order the accessible summary reads them out in. */
export const BODY_REGIONS: BodyRegionKey[] = ["neck", "chest", "waist", "hip", "upperArm", "thigh", "calf"];

/** All drawn shapes, in the order they are painted. */
export const outlineShapes = (outline: BodyOutline) => [outline.silhouette];

/** The shapes belonging to one clip group. */
export const clipShapes = (outline: BodyOutline, group: BodyClipGroup) =>
  group === "arms" ? outline.arms : [outline.torso];

/**
 * Clearance between the arm and the body it hangs beside, used to tell one
 * from the other when a pointer target is cut.
 */
const ARM_GAP = 6;

interface BodyWidths {
  neck: number;
  chest: number;
  waist: number;
  hip: number;
  arm: number;
  thigh: number;
  calf: number;
  /** Half the biacromial span. */
  shoulder: number;
  /** Half the span across the deltoids, which is what the drawing shows. */
  deltoid: number;
}

function widths(input: BodyOutlineInput, appearance: BodyAppearance): BodyWidths {
  const arm = halfWidth(input.upperArmCm, CROSS_SECTION.arm);
  const shoulder = (SHOULDER_SPAN[appearance.type] * FIGURE_SHOULDER[appearance.figure] * STATURE) / 2;
  return {
    neck: halfWidth(input.neckCm, CROSS_SECTION.neck),
    chest: halfWidth(input.chestCm, CROSS_SECTION.chest),
    waist: halfWidth(input.waistCm, CROSS_SECTION.waist),
    hip: halfWidth(input.hipCm, CROSS_SECTION.hip),
    arm,
    thigh: halfWidth(input.thighCm, CROSS_SECTION.thigh),
    calf: halfWidth(input.calfCm, CROSS_SECTION.calf),
    shoulder,
    deltoid: shoulder + arm * 0.55,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Catmull-Rom through the anchor points, emitted as cubic beziers. Straight
 * segments between measured circumferences would read as a technical drawing
 * rather than a body.
 */
function curveThrough(points: Point[], tension = 0.85): string {
  let d = "";
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const start = points[index];
    const end = points[index + 1];
    const next = points[index + 2] ?? end;
    const c1 = {
      x: start.x + ((end.x - previous.x) / 6) * tension,
      y: start.y + ((end.y - previous.y) / 6) * tension,
    };
    const c2 = {
      x: end.x - ((next.x - start.x) / 6) * tension,
      y: end.y - ((next.y - start.y) / 6) * tension,
    };
    d += ` C${round(c1.x)},${round(c1.y)} ${round(c2.x)},${round(c2.y)} ${round(end.x)},${round(end.y)}`;
  }
  return d;
}

const mirror = (points: Point[]) => points.map((point) => ({ x: 2 * BODY_VIEW.cx - point.x, y: point.y }));

const closedCurve = (points: Point[]) => `M${round(points[0].x)},${round(points[0].y)}${curveThrough(points)} Z`;

/** Reflects a path around the figure's centre line without re-deriving it. */
function mirrorPath(path: string): string {
  return path.replace(
    /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g,
    (_match, x: string, y: string) => `${round(2 * BODY_VIEW.cx - Number(x))},${y}`,
  );
}

/** A point on the skull, measured as an angle from the crown. */
function skullPoint(angleDeg: number, rx: number, ry: number): Point {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: BODY_VIEW.cx + Math.sin(radians) * rx,
    y: CROWN + ry - Math.cos(radians) * ry,
  };
}

/**
 * The arm as an axis hanging from the shoulder joint, with a half-width at each
 * stop along it. Everything the arm needs — its outline, the band clipped to
 * it, its pointer target and its caliper — comes from this one construction.
 */
interface ArmGeometry {
  outer: Point[];
  inner: Point[];
  /** Centre of the upper arm, where its circumference is measured. */
  midUpper: Point;
}

function armGeometry(w: BodyWidths, style: BodyShapeStyle): ArmGeometry {
  const radians = (ARM_DEG[style] * Math.PI) / 180;
  const along = { x: Math.sin(radians), y: Math.cos(radians) };
  const across = { x: Math.cos(radians), y: -Math.sin(radians) };
  const joint = { x: BODY_VIEW.cx + w.deltoid - w.arm, y: Y.shoulder + 0.03 * STATURE };
  const at = (distance: number) => ({
    x: joint.x + along.x * distance * STATURE,
    y: joint.y + along.y * distance * STATURE,
  });
  /* Deltoid, mid upper arm, elbow, the belly of the forearm, wrist, hand and
     fingertips: the stops a hanging arm actually narrows and swells at. */
  const stops: { at: number; half: number }[] = [
    { at: 0.02, half: w.arm * 1.06 },
    { at: ARM_SEGMENT.upper * 0.55, half: w.arm },
    { at: ARM_SEGMENT.upper, half: w.arm * 0.8 },
    { at: ARM_SEGMENT.upper + ARM_SEGMENT.fore * 0.32, half: w.arm * 0.86 },
    { at: ARM_SEGMENT.upper + ARM_SEGMENT.fore, half: w.arm * 0.5 },
    { at: ARM_SEGMENT.upper + ARM_SEGMENT.fore + ARM_SEGMENT.hand * 0.45, half: w.arm * 0.72 },
    { at: ARM_SEGMENT.upper + ARM_SEGMENT.fore + ARM_SEGMENT.hand, half: w.arm * 0.2 },
  ];
  const centres = stops.map((stop) => at(stop.at));
  return {
    outer: centres.map((centre, index) => ({
      x: centre.x + across.x * stops[index].half,
      y: centre.y + across.y * stops[index].half,
    })),
    inner: centres
      .map((centre, index) => ({
        x: centre.x - across.x * stops[index].half,
        y: centre.y - across.y * stops[index].half,
      }))
      .reverse(),
    midUpper: at(ARM_SEGMENT.upper * 0.5),
  };
}

/**
 * The legs as a centre line with a half-width at each level. Built this way the
 * thighs hang from the hip rather than being added to it — two thighs at their
 * widest are about as wide as the hips above them, which is what stops the
 * drawing needing a fudge factor to stay plausible.
 */
function legGeometry(w: BodyWidths) {
  const centre = {
    crotch: w.hip * 0.98 - w.thigh,
    thigh: w.hip * 0.52,
    knee: w.hip * 0.46,
    calf: w.hip * 0.42,
    ankle: w.hip * 0.4,
  };
  const half = {
    crotch: w.thigh,
    thigh: w.thigh * 0.88,
    knee: w.thigh * 0.52,
    calf: w.calf * 0.92,
    ankle: w.calf * 0.44,
  };
  return { centre, half };
}

export function buildBodyOutline(
  input: BodyOutlineInput,
  appearance: BodyAppearance,
  style: BodyShapeStyle = DEFAULT_SHAPE_STYLE,
): BodyOutline {
  const w = widths(input, appearance);
  const { cx } = BODY_VIEW;
  const arm = armGeometry(w, style);
  const leg = legGeometry(w);

  /* The skull is a true arc rather than a smoothed polygon: a head is the one
     part of the figure that no measurement changes, and an approximated one
     reads as a defect. It runs from the crown to where the jaw gives way to
     the neck, and the mirrored half brings it back. */
  const skullEnd = skullPoint(SKULL_END_DEG, HEAD_HALF, HEAD_RY);
  const head: Point[] = [skullEnd, { x: cx + w.neck, y: Y.neckBase }];

  /* Trapezius out to the acromion, then over the deltoid and down the arm. */
  const yoke: Point[] = [
    { x: cx + w.shoulder * 0.55, y: Y.neckBase + 0.012 * STATURE },
    { x: cx + w.shoulder * 0.92, y: Y.shoulder },
    { x: cx + w.deltoid, y: Y.shoulder + 0.028 * STATURE },
  ];

  const torso: Point[] = [
    { x: cx + w.chest * 0.99, y: Y.armpit },
    { x: cx + w.chest, y: Y.chest },
    { x: cx + w.chest * 0.62 + w.waist * 0.38, y: Y.underbust },
    { x: cx + w.waist, y: Y.waist },
    { x: cx + w.waist * 0.35 + w.hip * 0.65, y: Y.navel + 0.02 * STATURE },
    { x: cx + w.hip, y: Y.hip },
  ];

  const legOuter: Point[] = [
    { x: cx + leg.centre.crotch + leg.half.crotch, y: Y.crotch },
    { x: cx + leg.centre.thigh + leg.half.thigh, y: Y.thigh },
    { x: cx + leg.centre.knee + leg.half.knee, y: Y.knee },
    { x: cx + leg.centre.calf + leg.half.calf, y: Y.calf },
    { x: cx + leg.centre.ankle + leg.half.ankle, y: Y.ankle },
  ];
  /* Front view: the foot is foreshortened to a low, slightly splayed wedge. */
  const foot: Point[] = [
    { x: cx + leg.centre.ankle + w.calf * 0.66, y: Y.sole - 0.01 * STATURE },
    { x: cx + leg.centre.ankle + w.calf * 0.62, y: Y.sole },
    { x: cx + leg.centre.ankle - w.calf * 0.56, y: Y.sole },
    { x: cx + leg.centre.ankle - w.calf * 0.5, y: Y.sole - 0.01 * STATURE },
  ];
  /* The thighs touch from the crotch down to about mid-thigh; the gap opens
     below it. Anything else reads as a stance, which this figure never takes. */
  const legInner: Point[] = [
    { x: cx + leg.centre.ankle - leg.half.ankle, y: Y.ankle },
    { x: cx + leg.centre.calf - leg.half.calf, y: Y.calf },
    { x: cx + leg.centre.knee - leg.half.knee, y: Y.knee },
    { x: cx + Math.max(leg.centre.thigh - leg.half.thigh, 4), y: Y.thigh },
    { x: cx + 2.5, y: Y.crotch + 0.03 * STATURE },
  ];

  const right = [...head, ...yoke, ...arm.outer, ...arm.inner, ...torso, ...legOuter, ...foot, ...legInner];
  const skullArc = (to: Point) => ` A${round(HEAD_HALF)},${round(HEAD_RY)} 0 0 1 ${round(to.x)},${round(to.y)}`;

  const silhouette =
    `M${round(cx)},${round(CROWN)}` +
    skullArc(skullEnd) +
    curveThrough([...right, ...mirror([...right].reverse())]) +
    skullArc({ x: cx, y: CROWN }) +
    " Z";

  /* Clip shapes. Never drawn, so they only have to line up with the parts of
     the silhouette whose change bands they carry. */
  const torsoRight = [
    ...head,
    yoke[0],
    { x: cx + w.chest * 0.99, y: Y.shoulder + 0.02 * STATURE },
    ...torso,
    ...legOuter,
    ...foot,
    ...legInner,
  ];
  const torsoShape = closedCurve([...torsoRight, ...mirror([...torsoRight].reverse())]);
  const rightArm = closedCurve([...arm.outer, ...arm.inner]);

  return { silhouette, torso: torsoShape, arms: [mirrorPath(rightArm), rightArm] };
}

/* -------------------------------------------------------------- Figure art */

/**
 * The drawn figure: the measured outline plus the features that make it read as
 * a person rather than a diagram — hair, underwear and a few interior lines.
 * They carry no data; they exist so the reader recognises themselves in it.
 */
export interface BodyFigureArt {
  outline: BodyOutline;
  /** Long hair, drawn behind the body so the head covers its inner edge. */
  hairBack: string | null;
  /** The part of the hair that sits over the skull. */
  hairFront: string;
  /** Garments, clipped to the body when drawn. */
  briefs: string;
  bra: string | null;
  /** Thin interior lines: collarbone, bra straps, knees. */
  contours: string[];
  navel: { cx: number; cy: number; r: number };
}

interface HairStyle {
  /** Half-angle of the cap, in degrees from the crown. */
  spread: number;
  /** How far the fringe reaches down the forehead, as a fraction of the skull. */
  fringe: number;
  /** Sideways offset of the parting. */
  part: number;
  long: boolean;
}

const HAIR: Record<BodyFigure, HairStyle> = {
  MASCULINE: { spread: 112, fringe: 0.2, part: 5, long: false },
  NEUTRAL: { spread: 106, fringe: 0.3, part: 0, long: false },
  FEMININE: { spread: 126, fringe: 0.12, part: -6, long: true },
};

const move = (point: Point) => `M${round(point.x)},${round(point.y)}`;
const lineTo = (point: Point) => ` L${round(point.x)},${round(point.y)}`;
const curveTo = (c1: Point, c2: Point, end: Point) =>
  ` C${round(c1.x)},${round(c1.y)} ${round(c2.x)},${round(c2.y)} ${round(end.x)},${round(end.y)}`;

/** Hair sits on the same ellipse as the skull, one step outside it. */
function buildHair(style: HairStyle): { front: string; back: string | null } {
  const { cx } = BODY_VIEW;
  const rx = HEAD_HALF + 2;
  const ry = HEAD_RY + 2;
  const centreY = CROWN + HEAD_RY;
  const left = skullPoint(-style.spread, rx, ry);
  const right = skullPoint(style.spread, rx, ry);
  const fringeY = centreY - ry * (1 - 2 * style.fringe);
  const fringe = { x: cx + style.part, y: fringeY };

  /* Cap: over the crown on the outside, back along the hairline on the inside.
     A cap wider than a half-circle is the major arc, so the large-arc flag has
     to say so or the renderer sweeps it under the chin instead. */
  const largeArc = style.spread > 90 ? 1 : 0;
  const front =
    move(left) +
    ` A${round(rx)},${round(ry)} 0 ${largeArc} 1 ${round(right.x)},${round(right.y)}` +
    curveTo({ x: cx + rx * 0.8, y: centreY - ry * 0.45 }, { x: fringe.x + rx * 0.34, y: fringeY }, fringe) +
    curveTo({ x: fringe.x - rx * 0.4, y: fringeY - 1 }, { x: cx - rx * 0.84, y: centreY - ry * 0.42 }, left) +
    " Z";

  if (!style.long) return { front, back: null };

  /* Two panels falling past the shoulders, mirrored around the centre line. */
  const panel =
    move({ x: cx + rx * 0.84, y: centreY - ry * 0.3 }) +
    curveTo({ x: cx + rx + 4, y: centreY + ry * 0.8 }, { x: cx + rx + 5, y: Y.shoulder + 20 }, {
      x: cx + rx + 1,
      y: Y.shoulder + 52,
    }) +
    lineTo({ x: cx + rx - 10, y: Y.shoulder + 50 }) +
    curveTo({ x: cx + rx - 8, y: Y.shoulder + 18 }, { x: cx + rx - 9, y: centreY + ry * 0.7 }, {
      x: cx + rx * 0.5,
      y: centreY - ry * 0.2,
    }) +
    " Z";

  return { front, back: `${panel} ${mirrorPath(panel)}` };
}

export function buildBodyFigure(
  input: BodyOutlineInput,
  appearance: BodyAppearance,
  style: BodyShapeStyle = DEFAULT_SHAPE_STYLE,
): BodyFigureArt {
  const w = widths(input, appearance);
  const { cx, width } = BODY_VIEW;
  const feminine = appearance.figure === "FEMININE";
  const masculine = appearance.figure === "MASCULINE";
  const hair = buildHair(HAIR[appearance.figure]);
  const leg = legGeometry(w);

  /* Garments are clipped to the body, so they may run past its edges. */
  const briefsTop = masculine ? Y.hip - 2 : Y.hip - 14;
  const briefs = masculine
    ? /* Trunks: a straight hem across both upper thighs. */
      `M0,${round(briefsTop)} L${width},${round(briefsTop)} L${width},${round(Y.crotch + 20)} L0,${round(
        Y.crotch + 20,
      )} Z`
    : /* Briefs: the hem rises towards the hips. */
      move({ x: 0, y: briefsTop }) +
      lineTo({ x: width, y: briefsTop }) +
      lineTo({ x: width, y: Y.hip + 12 }) +
      curveTo(
        { x: cx + w.hip * 0.9, y: Y.hip + 18 },
        { x: cx + w.hip * 0.45, y: Y.crotch + 12 },
        { x: cx, y: Y.crotch + 12 },
      ) +
      curveTo(
        { x: cx - w.hip * 0.45, y: Y.crotch + 12 },
        { x: cx - w.hip * 0.9, y: Y.hip + 18 },
        { x: 0, y: Y.hip + 12 },
      ) +
      " Z";

  const bandTop = Y.chest - 15;
  const bandBottom = Y.chest + 9;
  const bra = feminine
    ? move({ x: 0, y: bandTop }) +
      lineTo({ x: width, y: bandTop }) +
      lineTo({ x: width, y: bandBottom }) +
      curveTo(
        { x: cx + w.chest * 0.6, y: bandBottom + 4 },
        { x: cx + w.chest * 0.3, y: bandBottom - 13 },
        { x: cx, y: bandBottom - 13 },
      ) +
      curveTo(
        { x: cx - w.chest * 0.3, y: bandBottom - 13 },
        { x: cx - w.chest * 0.6, y: bandBottom + 4 },
        { x: 0, y: bandBottom },
      ) +
      " Z"
    : null;

  const contours = [
    /* Collarbone. */
    move({ x: cx - w.chest * 0.5, y: Y.armpit - 18 }) +
      curveTo(
        { x: cx - w.chest * 0.2, y: Y.armpit - 10 },
        { x: cx + w.chest * 0.2, y: Y.armpit - 10 },
        { x: cx + w.chest * 0.5, y: Y.armpit - 18 },
      ),
    /* Knees. */
    move({ x: cx + leg.centre.knee - leg.half.knee * 0.7, y: Y.knee - 2 }) +
      curveTo(
        { x: cx + leg.centre.knee - leg.half.knee * 0.2, y: Y.knee + 7 },
        { x: cx + leg.centre.knee + leg.half.knee * 0.2, y: Y.knee + 7 },
        { x: cx + leg.centre.knee + leg.half.knee * 0.7, y: Y.knee - 2 },
      ),
  ];
  contours.push(mirrorPath(contours[1]));

  if (bra) {
    /* Straps, from the band up over each shoulder. */
    const strap =
      move({ x: cx + w.chest * 0.5, y: bandTop + 2 }) +
      curveTo(
        { x: cx + w.chest * 0.62, y: bandTop - 14 },
        { x: cx + w.shoulder * 0.62, y: Y.shoulder + 14 },
        { x: cx + w.shoulder * 0.55, y: Y.shoulder + 4 },
      );
    contours.push(strap, mirrorPath(strap));
  }

  return {
    outline: buildBodyOutline(input, appearance, style),
    hairBack: hair.back,
    hairFront: hair.front,
    briefs,
    bra,
    contours,
    navel: { cx, cy: Y.navel, r: 1.8 },
  };
}

/* ------------------------------------------------------------ Region bands */

/**
 * Bands used both for the change heat map and as pointer targets. Painted bands
 * are clipped to their group; pointer targets are plain, disjoint rectangles.
 */
export function bodyRegionGeometry(
  input: BodyOutlineInput,
  appearance: BodyAppearance,
  style: BodyShapeStyle = DEFAULT_SHAPE_STYLE,
): BodyRegionGeometry[] {
  const w = widths(input, appearance);
  const { cx } = BODY_VIEW;
  const arm = armGeometry(w, style);
  const leg = legGeometry(w);
  const band = (halfW: number, top: number, bottom: number): Rect => ({
    x: cx - halfW,
    y: top,
    width: halfW * 2,
    height: bottom - top,
  });
  const fullWidth = (top: number, bottom: number): Rect => ({
    x: 0,
    y: top,
    width: BODY_VIEW.width,
    height: bottom - top,
  });
  /* Everything wider than the ribcage is an arm, and nothing narrower is. */
  const armDivide = w.chest + ARM_GAP;
  const rightLabel = (y: number) => ({ x: 306, y, anchor: "start" as const });
  const leftLabel = (y: number) => ({ x: 74, y, anchor: "end" as const });
  const torsoBand = (key: BodyRegionKey, halfW: number, top: number, bottom: number, y: number) => {
    const rect = band(halfW + 2, top, bottom);
    return { key, clip: "body" as const, rects: [rect], hitRects: [rect], label: rightLabel(y) };
  };
  const legHit = (centre: number, halfW: number, top: number, bottom: number): Rect[] =>
    [-1, 1].map((side) => ({
      x: cx + side * centre - halfW,
      y: top,
      width: halfW * 2,
      height: bottom - top,
    }));

  return [
    torsoBand("neck", w.neck, Y.neckBase - 16, Y.neckBase + 6, Y.neckBase - 4),
    torsoBand("chest", w.chest, Y.chest - 18, Y.chest + 18, Y.chest + 4),
    torsoBand("waist", w.waist, Y.waist - 16, Y.waist + 16, Y.waist + 4),
    torsoBand("hip", w.hip, Y.hip - 13, Y.hip + 16, Y.hip + 4),
    {
      key: "upperArm",
      clip: "arms",
      rects: [fullWidth(Y.shoulder + 10, Y.waist + 6)],
      hitRects: [
        { x: 0, y: Y.shoulder + 10, width: cx - armDivide, height: Y.waist - Y.shoulder - 4 },
        { x: cx + armDivide, y: Y.shoulder + 10, width: cx - armDivide, height: Y.waist - Y.shoulder - 4 },
      ],
      label: leftLabel(arm.midUpper.y + 6),
    },
    {
      key: "thigh",
      clip: "body",
      rects: [fullWidth(Y.crotch + 6, Y.knee - 12)],
      hitRects: legHit(leg.centre.thigh, leg.half.thigh + 6, Y.crotch + 6, Y.knee - 12),
      label: leftLabel(Y.thigh + 4),
    },
    {
      key: "calf",
      clip: "body",
      rects: [fullWidth(Y.knee + 6, Y.ankle)],
      hitRects: legHit(leg.centre.calf, leg.half.calf + 7, Y.knee + 6, Y.ankle),
      label: leftLabel(Y.calf + 4),
    },
  ];
}

/* ---------------------------------------------------------- Measure figure */

/**
 * One measured level of the body: where a caliper is drawn across the figure,
 * and where its label sits in the column beside it. The caliper measures the
 * drawing; the number beside it is the recorded circumference, which is why the
 * two are never the same span.
 */
export interface BodyMeasureRow {
  key: BodyRegionKey;
  /** Centre of the measured span. */
  cx: number;
  /** Half the drawn breadth at that level. */
  half: number;
  y: number;
  /** Where this row's label sits, after rows have been pushed apart. */
  labelY: number;
}

/** Room a label needs before the one below it starts. */
export const MEASURE_ROW_GAP = 40;

/**
 * A caliper for every recorded circumference, top to bottom. Torso levels are
 * measured across the centre line; the limbs are measured on the arm and leg
 * nearest the labels, because a caliper on the far limb has to cross the whole
 * figure to reach its own number.
 */
export function bodyMeasureRows(input: BodyOutlineInput, appearance: BodyAppearance): BodyMeasureRow[] {
  const w = widths(input, appearance);
  const { cx } = BODY_VIEW;
  const arm = armGeometry(w, "MEASURE");
  const leg = legGeometry(w);
  const rows: Omit<BodyMeasureRow, "labelY">[] = [
    { key: "neck", cx, half: w.neck, y: Y.neckBase - 8 },
    { key: "chest", cx, half: w.chest, y: Y.chest },
    { key: "waist", cx, half: w.waist, y: Y.waist },
    { key: "hip", cx, half: w.hip, y: Y.hip },
    { key: "upperArm", cx: arm.midUpper.x, half: w.arm, y: arm.midUpper.y },
    { key: "thigh", cx: cx + leg.centre.thigh, half: leg.half.thigh, y: Y.thigh },
    { key: "calf", cx: cx + leg.centre.calf, half: leg.half.calf, y: Y.calf },
  ];

  /* Labels follow their caliper, then get pushed down until they stop
     colliding: a stack of rows the reader can follow beats a label sitting
     exactly on a line it has been pushed off anyway. */
  const ordered = [...rows].sort((a, b) => a.y - b.y);
  let previous = -Infinity;
  const labelled = new Map<BodyRegionKey, number>();
  for (const row of ordered) {
    const labelY = Math.max(row.y, previous + MEASURE_ROW_GAP);
    labelled.set(row.key, labelY);
    previous = labelY;
  }

  return rows.map((row) => ({ ...row, labelY: labelled.get(row.key)! }));
}

/**
 * Opacity for a region's change treatment. Magnitude is relative so a 1 cm move
 * at the calf reads as strongly as the same relative move at the waist.
 */
export function changeIntensity(percent: number | null): number {
  if (percent == null) return 0;
  return 0.14 + Math.min(Math.abs(percent) / 6, 1) * 0.32;
}
