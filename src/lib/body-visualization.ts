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

/**
 * A build for the drawn figure. Both halves are the reader's own choice: the
 * somatotype is never inferred from their measurements and never enters a
 * calculation, and the presentation is separate from the profile's
 * `biologicalSex`, which is a clinical input to the energy and RFM formulas.
 */
export type BodyType = "ECTOMORPH" | "MESOMORPH" | "ENDOMORPH";
export type BodyFigure = "NEUTRAL" | "MASCULINE" | "FEMININE";

export interface BodyAppearance {
  type: BodyType;
  figure: BodyFigure;
}

export const BODY_TYPES: BodyType[] = ["ECTOMORPH", "MESOMORPH", "ENDOMORPH"];
export const BODY_FIGURES: BodyFigure[] = ["NEUTRAL", "MASCULINE", "FEMININE"];

/** Used until someone picks, and for anyone who never does. */
export const DEFAULT_APPEARANCE: BodyAppearance = { type: "MESOMORPH", figure: "NEUTRAL" };

/**
 * Which of the two visualisations a reader wants to see. They are a display
 * preference, not a data one: hiding a panel never stops a value being
 * recorded, exported or shown in the table below the card.
 */
export interface BodyPanels {
  composition: boolean;
  shape: boolean;
}

/** Both on, for everyone who never opens the setting. */
export const DEFAULT_PANELS: BodyPanels = { composition: true, shape: true };

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
 * Half the shoulder span as a multiple of the ribcage, which is the one
 * proportion no tape measure captures. It only ever widens the deltoid past the
 * arm hanging below it, so a broad build reads as broad shoulders rather than
 * as thicker arms.
 */
const SHOULDER_SPAN: Record<BodyType, number> = {
  ECTOMORPH: 1.42,
  MESOMORPH: 1.6,
  ENDOMORPH: 1.5,
};

const FIGURE_SHOULDER: Record<BodyFigure, number> = { MASCULINE: 1.06, NEUTRAL: 1.0, FEMININE: 0.94 };

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
   * with no seam across them, the way the reference sheet reads; the channel
   * between arm and waist is left open at the bottom rather than enclosed.
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

function widths(input: BodyOutlineInput, appearance: BodyAppearance) {
  const chest = halfWidth(input.chestCm, TORSO);
  return {
    neck: halfWidth(input.neckCm, CIRCLE),
    chest,
    waist: halfWidth(input.waistCm, TORSO),
    hip: halfWidth(input.hipCm, TORSO),
    /* The deltoids sit wider than the ribcage, by how much the build says. */
    shoulder: chest * SHOULDER_SPAN[appearance.type] * FIGURE_SHOULDER[appearance.figure],
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

/** How square the shoulders sit above the arm. */
const TRAPEZIUS: Record<BodyType, number> = { ECTOMORPH: 0.6, MESOMORPH: 0.72, ENDOMORPH: 0.66 };

export function buildBodyOutline(input: BodyOutlineInput, appearance: BodyAppearance): BodyOutline {
  const w = widths(input, appearance);
  const { cx } = BODY_VIEW;
  const r = Y.headRadius;

  /* The armpit sits at about the width of the ribcage, and the arm hangs
     outside it: that is what sets the figure's overall span. */
  const armInner = w.chest * 0.98;
  const armOuter = armInner + 2 * w.arm;
  /* A build broader than its own arms bulges at the deltoid and narrows again
     below it; a narrow one just carries on down the arm. */
  const deltoid = Math.max(armOuter, w.shoulder);
  const trap = TRAPEZIUS[appearance.type];

  /* The skull is a true arc rather than a smoothed polygon: a head is the one
     part of the figure that no measurement changes, and an approximated one
     reads as a defect. */
  const crown = { x: cx, y: Y.headCenter - r };
  const jaw = { x: cx + r * Math.sin(JAW_ANGLE), y: Y.headCenter - r * Math.cos(JAW_ANGLE) };

  const head: Point[] = [
    { x: jaw.x - cx, y: jaw.y },
    { x: w.neck, y: Y.neckBottom },
  ];

  /* Down the outside of the arm, round the hand, and back up the inside to the
     armpit. The gap this leaves beside the waist stays open at the bottom. */
  const arm: Point[] = [
    { x: deltoid * trap, y: Y.shoulder - 8 },
    { x: deltoid, y: Y.shoulder + 14 },
    { x: armOuter + 1, y: Y.chest + 26 },
    { x: armOuter - 1, y: Y.waist + 14 },
    { x: armOuter + 2, y: Y.hip + 18 },
    { x: armOuter - 2, y: Y.crotch + 8 },
    { x: armOuter - 4, y: Y.crotch + 30 },
    { x: armOuter - 4 - 2 * w.arm * 0.7, y: Y.crotch + 26 },
    { x: armOuter - 2 - 2 * w.arm * 0.78, y: Y.crotch + 6 },
    { x: armOuter + 2 - 2 * w.arm * 0.85, y: Y.hip + 16 },
    { x: armOuter - 1 - 2 * w.arm * 0.95, y: Y.waist + 12 },
    { x: armOuter + 1 - 2 * w.arm, y: Y.chest + 24 },
    { x: armInner, y: Y.chest + 4 },
  ];

  const torsoAndLegs: Point[] = [
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
  ];

  const absolute = (points: Point[]) => points.map((point) => ({ x: cx + point.x, y: point.y }));
  const rightHalf = absolute([...head, ...arm, ...torsoAndLegs]);
  const leftHalf = mirror([...rightHalf].reverse()).slice(1);
  const arc = (to: Point) => ` A${r},${r} 0 0 1 ${round(to.x)},${round(to.y)}`;

  const silhouette =
    `M${round(crown.x)},${round(crown.y)}` +
    arc(jaw) +
    curveThrough([...rightHalf, ...leftHalf]) +
    arc(crown) +
    " Z";

  /* Clip shapes. Never drawn, so they only have to line up with the parts of
     the silhouette whose change bands they carry. */
  const torsoRight = absolute([
    ...head,
    { x: armInner * trap, y: Y.shoulder - 8 },
    { x: armInner, y: Y.shoulder + 12 },
    { x: armInner, y: Y.chest + 4 },
    ...torsoAndLegs,
  ]);
  const torso = closedCurve([...torsoRight, ...mirror([...torsoRight].reverse()).slice(1)]);

  const rightArm = closedCurve(absolute(arm.slice(1, -1)));

  return { silhouette, torso, arms: [mirrorPath(rightArm), rightArm] };
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
  FEMININE: { spread: 126, fringe: 0.1, part: -6, long: true },
};

/** A point on the skull, measured as an angle from the crown. */
function skullPoint(angleDeg: number, radius: number): Point {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: BODY_VIEW.cx + Math.sin(radians) * radius,
    y: Y.headCenter - Math.cos(radians) * radius,
  };
}

const move = (point: Point) => `M${round(point.x)},${round(point.y)}`;
const lineTo = (point: Point) => ` L${round(point.x)},${round(point.y)}`;
const curveTo = (c1: Point, c2: Point, end: Point) =>
  ` C${round(c1.x)},${round(c1.y)} ${round(c2.x)},${round(c2.y)} ${round(end.x)},${round(end.y)}`;

function buildHair(style: HairStyle): { front: string; back: string | null } {
  const { cx } = BODY_VIEW;
  const r = Y.headRadius;
  const outer = r + 2;
  const left = skullPoint(-style.spread, outer);
  const right = skullPoint(style.spread, outer);
  const fringeY = Y.headCenter - r * style.fringe;
  const fringe = { x: cx + style.part, y: fringeY };

  /* Cap: over the crown on the outside, back along the hairline on the inside. */
  /* A cap wider than a half-circle is the major arc, so the large-arc flag has
     to say so or the renderer sweeps it under the chin instead. */
  const largeArc = style.spread > 90 ? 1 : 0;
  const front =
    move(left) +
    ` A${outer},${outer} 0 ${largeArc} 1 ${round(right.x)},${round(right.y)}` +
    curveTo({ x: cx + r * 0.82, y: Y.headCenter - r * 0.5 }, { x: fringe.x + r * 0.34, y: fringeY }, fringe) +
    curveTo({ x: fringe.x - r * 0.4, y: fringeY - 1 }, { x: cx - r * 0.86, y: Y.headCenter - r * 0.46 }, {
      x: left.x,
      y: left.y,
    }) +
    " Z";

  if (!style.long) return { front, back: null };

  /* Two panels falling past the shoulders, mirrored around the centre line. */
  const rightPanel =
    move({ x: cx + r * 0.86, y: Y.headCenter - 10 }) +
    curveTo({ x: cx + r + 4, y: Y.headCenter + 30 }, { x: cx + r + 5, y: Y.shoulder + 24 }, {
      x: cx + r + 2,
      y: Y.shoulder + 58,
    }) +
    lineTo({ x: cx + r - 9, y: Y.shoulder + 56 }) +
    curveTo({ x: cx + r - 7, y: Y.shoulder + 22 }, { x: cx + r - 8, y: Y.headCenter + 28 }, {
      x: cx + r * 0.5,
      y: Y.headCenter - 6,
    }) +
    " Z";

  return { front, back: `${rightPanel} ${mirrorPath(rightPanel)}` };
}

/** Reflects a path around the figure's centre line without re-deriving it. */
function mirrorPath(path: string): string {
  return path.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_match, x: string, y: string) =>
    `${round(2 * BODY_VIEW.cx - Number(x))},${y}`,
  );
}

export function buildBodyFigure(input: BodyOutlineInput, appearance: BodyAppearance): BodyFigureArt {
  const w = widths(input, appearance);
  const { cx, width } = BODY_VIEW;
  const feminine = appearance.figure === "FEMININE";
  const masculine = appearance.figure === "MASCULINE";
  const hair = buildHair(HAIR[appearance.figure]);

  /* Garments are clipped to the body, so they may run past its edges. */
  const briefsTop = masculine ? Y.waist + 42 : Y.hip - 14;
  const briefs = masculine
    ? /* Trunks: a straight hem across both upper thighs. */
      `M0,${briefsTop} L${width},${briefsTop} L${width},${Y.crotch + 22} L0,${Y.crotch + 22} Z`
    : /* Briefs: the hem rises towards the hips. */
      move({ x: 0, y: briefsTop }) +
      lineTo({ x: width, y: briefsTop }) +
      lineTo({ x: width, y: Y.hip + 16 }) +
      curveTo(
        { x: cx + w.hip * 0.9, y: Y.hip + 24 },
        { x: cx + w.hip * 0.45, y: Y.crotch + 14 },
        { x: cx, y: Y.crotch + 14 },
      ) +
      curveTo(
        { x: cx - w.hip * 0.45, y: Y.crotch + 14 },
        { x: cx - w.hip * 0.9, y: Y.hip + 24 },
        { x: 0, y: Y.hip + 16 },
      ) +
      " Z";

  const bandTop = Y.chest - 18;
  const bandBottom = Y.chest + 10;
  const bra = feminine
    ? move({ x: 0, y: bandTop }) +
      lineTo({ x: width, y: bandTop }) +
      lineTo({ x: width, y: bandBottom }) +
      curveTo(
        { x: cx + w.chest * 0.6, y: bandBottom + 4 },
        { x: cx + w.chest * 0.3, y: bandBottom - 15 },
        { x: cx, y: bandBottom - 15 },
      ) +
      curveTo(
        { x: cx - w.chest * 0.3, y: bandBottom - 15 },
        { x: cx - w.chest * 0.6, y: bandBottom + 4 },
        { x: 0, y: bandBottom },
      ) +
      " Z"
    : null;

  const contours = [
    /* Collarbone. */
    move({ x: cx - w.chest * 0.52, y: Y.shoulder + 14 }) +
      curveTo(
        { x: cx - w.chest * 0.2, y: Y.shoulder + 22 },
        { x: cx + w.chest * 0.2, y: Y.shoulder + 22 },
        { x: cx + w.chest * 0.52, y: Y.shoulder + 14 },
      ),
    /* Knees. */
    move({ x: cx + w.hip * 0.47 - w.thigh * 0.4, y: Y.knee - 2 }) +
      curveTo(
        { x: cx + w.hip * 0.47 - w.thigh * 0.1, y: Y.knee + 6 },
        { x: cx + w.hip * 0.47 + w.thigh * 0.1, y: Y.knee + 6 },
        { x: cx + w.hip * 0.47 + w.thigh * 0.4, y: Y.knee - 2 },
      ),
  ];
  contours.push(mirrorPath(contours[1]));

  if (bra) {
    /* Straps, from the band up over each shoulder. */
    const strap =
      move({ x: cx + w.chest * 0.5, y: bandTop + 2 }) +
      curveTo(
        { x: cx + w.chest * 0.62, y: bandTop - 14 },
        { x: cx + w.shoulder * 0.6, y: Y.shoulder + 14 },
        { x: cx + w.shoulder * 0.52, y: Y.shoulder + 4 },
      );
    contours.push(strap, mirrorPath(strap));
  }

  return {
    outline: buildBodyOutline(input, appearance),
    hairBack: hair.back,
    hairFront: hair.front,
    briefs,
    bra,
    contours,
    navel: { cx, cy: Y.waist + 16, r: 1.8 },
  };
}

/**
 * Bands used both for the change heat map and as pointer targets. Painted bands
 * are clipped to their group; pointer targets are plain, disjoint rectangles.
 */
export function bodyRegionGeometry(input: BodyOutlineInput, appearance: BodyAppearance): BodyRegionGeometry[] {
  const w = widths(input, appearance);
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
