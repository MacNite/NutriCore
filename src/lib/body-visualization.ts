import type { BodyMeasurement } from "./body-metrics";

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

/** Ratio of a current value to its reference; 1 when either side is unknown. */
export function axisRatio(current: number | null, reference: number | null): number {
  if (current == null || reference == null || reference === 0) return 1;
  return current / reference;
}

/* ------------------------------------------------------------- Body outline */

export const BODY_VIEW = { width: 340, height: 480, cx: 170 } as const;

/** Vertical anchors of the schematic figure, in view units. */
const Y = {
  headCenter: 40,
  headRadius: 27,
  jaw: 61,
  neckBottom: 84,
  shoulder: 98,
  chest: 144,
  waist: 208,
  hip: 260,
  crotch: 292,
  thigh: 330,
  knee: 374,
  calf: 410,
  ankle: 452,
} as const;

const PX_PER_CM = 2.35;

/**
 * A circumference becomes a width via an assumed cross-section: the neck and
 * limbs are treated as circles, the torso as an ellipse of roughly the
 * proportions of a human trunk.
 */
const halfWidth = (circumferenceCm: number, perimeterRatio: number) =>
  ((circumferenceCm / perimeterRatio) / 2) * PX_PER_CM;

const CIRCLE = Math.PI;
const TORSO = 2.75;
const THIGH = 3.0;
const CALF = 3.05;

/**
 * Drawn at true scale, two thighs are wider than the hips they hang from and
 * two arms make the figure a third as wide as it is tall. These factors keep
 * the silhouette plausible while every limb still moves with its measurement —
 * which is what the drawing is for. It is schematic, not anthropometric.
 */
const ARM_DISPLAY = 0.85;

/**
 * Clearance between the arm and the body it hangs beside. Wide enough that the
 * smoothing of either outline can never make the two touch.
 */
const ARM_GAP = 7;
const THIGH_DISPLAY = 0.82;
const CALF_DISPLAY = 0.86;

export interface BodyOutlineInput {
  neckCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  upperArmCm: number;
  thighCm: number;
  calfCm: number;
}

export function outlineInput(measurement: BodyMeasurement): BodyOutlineInput {
  return {
    neckCm: measurement.neckCm,
    chestCm: measurement.chestCm,
    waistCm: measurement.waistCm,
    hipCm: measurement.hipCm,
    upperArmCm: (measurement.upperArmLeftCm + measurement.upperArmRightCm) / 2,
    thighCm: (measurement.thighLeftCm + measurement.thighRightCm) / 2,
    calfCm: (measurement.calfLeftCm + measurement.calfRightCm) / 2,
  };
}

export interface BodyOutline {
  /** Head, neck, torso and both legs as one closed path: no internal seams. */
  body: string;
  /** The arms hang clear of the body, so they never cross its outline. */
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
export const outlineShapes = (outline: BodyOutline) => [outline.body, ...outline.arms];

/** The shapes belonging to one clip group. */
export const clipShapes = (outline: BodyOutline, group: BodyClipGroup) =>
  group === "arms" ? outline.arms : [outline.body];

function widths(input: BodyOutlineInput) {
  const chest = halfWidth(input.chestCm, TORSO);
  return {
    neck: halfWidth(input.neckCm, CIRCLE),
    chest,
    waist: halfWidth(input.waistCm, TORSO),
    hip: halfWidth(input.hipCm, TORSO),
    /* The deltoids sit a little wider than the ribcage. */
    shoulder: chest * 1.05,
    arm: halfWidth(input.upperArmCm, CIRCLE) * ARM_DISPLAY,
    thigh: halfWidth(input.thighCm, THIGH) * THIGH_DISPLAY,
    calf: halfWidth(input.calfCm, CALF) * CALF_DISPLAY,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Catmull-Rom through the anchor points, emitted as cubic beziers. Straight
 * segments between measured circumferences would read as a technical drawing
 * rather than a body.
 */
function curveThrough(points: Point[], tension = 0.9): string {
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

const closedCurve = (points: Point[]) =>
  `M${round(points[0].x)},${round(points[0].y)}${curveThrough(points)} Z`;

/** Where the head circle meets the neck, measured from the crown. */
const JAW_ANGLE = (130 * Math.PI) / 180;

/** A limb is a centre line with a half-width at each anchor, closed into a shape. */
function limb(segments: { x: number; y: number; w: number }[]): Point[] {
  const outer = segments.map((segment) => ({ x: segment.x + segment.w, y: segment.y }));
  const inner = [...segments].reverse().map((segment) => ({ x: segment.x - segment.w, y: segment.y }));
  return [...outer, ...inner];
}

export function buildBodyOutline(input: BodyOutlineInput): BodyOutline {
  const w = widths(input);
  const { cx } = BODY_VIEW;
  const r = Y.headRadius;

  /* The skull is a true arc rather than a smoothed polygon: a head is the one
     part of the figure that no measurement changes, and an approximated one
     reads as a defect. */
  const crown = { x: cx, y: Y.headCenter - r };
  const jaw = { x: cx + r * Math.sin(JAW_ANGLE), y: Y.headCenter - r * Math.cos(JAW_ANGLE) };

  /* Right half of the figure, jaw down to the crotch. Offsets are relative to
     the centre line so the left half is a plain mirror. */
  const rightHalf: Point[] = [
    { x: jaw.x - cx, y: jaw.y },
    { x: w.neck, y: Y.neckBottom },
    { x: w.shoulder * 0.62, y: Y.shoulder - 10 },
    { x: w.shoulder, y: Y.shoulder + 4 },
    { x: w.chest, y: Y.chest },
    { x: w.waist, y: Y.waist },
    { x: w.hip, y: Y.hip },
    { x: w.hip * 0.94, y: Y.crotch },
    { x: w.hip * 0.5 + w.thigh, y: Y.thigh },
    { x: w.hip * 0.47 + w.thigh * 0.68, y: Y.knee },
    { x: w.hip * 0.45 + w.calf, y: Y.calf },
    { x: w.hip * 0.43 + w.calf * 0.5, y: Y.ankle },
    { x: w.hip * 0.43 - w.calf * 0.5, y: Y.ankle },
    { x: w.hip * 0.45 - w.calf, y: Y.calf },
    { x: w.hip * 0.47 - w.thigh * 0.68, y: Y.knee },
    /* The thighs meet at the crotch, so the inner edge is clamped rather than
       allowed to cross the centre line. */
    { x: Math.max(w.hip * 0.5 - w.thigh, 3), y: Y.thigh },
    { x: 0, y: Y.crotch + 14 },
  ].map((point) => ({ x: cx + point.x, y: point.y }));

  const leftHalf = mirror([...rightHalf].reverse()).slice(1);
  const arc = (to: Point) => ` A${r},${r} 0 0 1 ${round(to.x)},${round(to.y)}`;
  const body =
    `M${round(crown.x)},${round(crown.y)}` +
    arc(jaw) +
    curveThrough([...rightHalf, ...leftHalf]) +
    arc(crown) +
    " Z";

  /* The arm hangs beside the body, following its contour with a constant gap,
     which is both how an arm falls and what keeps the two outlines apart. */
  const rightArm = limb([
    { x: cx + w.shoulder + ARM_GAP + w.arm, y: Y.shoulder + 12, w: w.arm },
    { x: cx + w.chest + ARM_GAP + w.arm, y: Y.chest + 22, w: w.arm },
    { x: cx + w.waist + ARM_GAP + w.arm * 0.95, y: Y.waist + 6, w: w.arm * 0.95 },
    { x: cx + w.hip + ARM_GAP + w.arm * 0.75, y: Y.hip + 16, w: w.arm * 0.75 },
    { x: cx + w.hip + ARM_GAP + w.arm * 0.55, y: Y.crotch + 2, w: w.arm * 0.55 },
  ]);

  return {
    body,
    arms: [closedCurve(mirror(rightArm)), closedCurve(rightArm)],
  };
}

/**
 * Bands used both for the change heat map and as pointer targets. Painted bands
 * are clipped to their group; pointer targets are plain, disjoint rectangles.
 */
export function bodyRegionGeometry(input: BodyOutlineInput): BodyRegionGeometry[] {
  const w = widths(input);
  const { cx } = BODY_VIEW;
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
  const legX = w.hip * 0.5;
  /* Everything wider than the ribcage is an arm, and nothing narrower is. */
  const armDivide = w.chest + ARM_GAP;
  const rightLabel = (y: number) => ({ x: 264, y, anchor: "start" as const });
  const leftLabel = (y: number) => ({ x: 76, y, anchor: "end" as const });
  const torsoBand = (key: BodyRegionKey, halfW: number, top: number, bottom: number, y: number) => {
    const rect = band(halfW + 2, top, bottom);
    return { key, clip: "body" as const, rects: [rect], hitRects: [rect], label: rightLabel(y) };
  };

  return [
    torsoBand("neck", w.neck, Y.neckBottom - 18, Y.neckBottom + 8, Y.neckBottom - 6),
    torsoBand("chest", w.chest, Y.chest - 26, Y.chest + 26, Y.chest + 4),
    torsoBand("waist", w.waist, Y.waist - 24, Y.waist + 24, Y.waist + 4),
    torsoBand("hip", w.hip, Y.hip - 22, Y.hip + 24, Y.hip + 4),
    {
      key: "upperArm",
      clip: "arms",
      rects: [fullWidth(Y.shoulder + 10, Y.waist + 10)],
      hitRects: [
        { x: 0, y: Y.shoulder + 10, width: cx - armDivide, height: Y.waist - Y.shoulder + 20 },
        { x: cx + armDivide, y: Y.shoulder + 10, width: cx - armDivide, height: Y.waist - Y.shoulder + 20 },
      ],
      label: leftLabel(Y.chest + 26),
    },
    {
      key: "thigh",
      clip: "body",
      rects: [fullWidth(Y.crotch + 6, Y.knee - 12)],
      hitRects: [
        { x: cx - legX - w.thigh - 5, y: Y.crotch + 6, width: (w.thigh + 5) * 2, height: Y.knee - Y.crotch - 18 },
        { x: cx + legX - w.thigh - 5, y: Y.crotch + 6, width: (w.thigh + 5) * 2, height: Y.knee - Y.crotch - 18 },
      ],
      label: leftLabel(Y.thigh + 4),
    },
    {
      key: "calf",
      clip: "body",
      rects: [fullWidth(Y.knee + 6, Y.ankle)],
      hitRects: [
        { x: cx - legX - w.calf - 7, y: Y.knee + 6, width: (w.calf + 7) * 2, height: Y.ankle - Y.knee - 6 },
        { x: cx + legX - w.calf - 7, y: Y.knee + 6, width: (w.calf + 7) * 2, height: Y.ankle - Y.knee - 6 },
      ],
      label: leftLabel(Y.calf + 4),
    },
  ];
}

/**
 * Opacity for a region's change treatment. Magnitude is relative so a 1 cm move
 * at the calf reads as strongly as the same relative move at the waist.
 */
export function changeIntensity(percent: number | null): number {
  if (percent == null) return 0;
  return 0.14 + Math.min(Math.abs(percent) / 6, 1) * 0.32;
}
