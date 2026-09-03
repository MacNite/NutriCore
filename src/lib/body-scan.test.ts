import { describe, expect, it } from "vitest";
import { ARM_SEGMENT, BODY_LANDMARKS } from "./body-visualization";
import {
  REGION_LEVEL,
  armClearance,
  assessCapture,
  bodyExtent,
  centralRunWidth,
  ellipsePerimeter,
  estimateCircumferences,
  levelRow,
  rowSpans,
  widthAt,
  type Silhouette,
} from "./body-scan";

/**
 * Synthetic bodies, so the answer is known before the code runs.
 *
 * A drawn figure whose widths are set per level is the only way to test a
 * geometric estimator honestly: a photograph has no ground truth attached, and
 * asserting against numbers the estimator itself produced would test nothing.
 */

/* Wide enough for arms held straight out: a T-pose spans most of a stature,
   and a frame that clips it would test the frame rather than the pose. */
const FRAME = { width: 400, height: 400 } as const;

interface FigureSpec {
  /** Rows of the frame the body occupies, top and bottom inclusive. */
  top: number;
  bottom: number;
  /** Half-width in pixels at a fraction of stature, interpolated between entries. */
  profile: { at: number; halfWidth: number }[];
  /**
   * An arm, drawn as a capsule from the shoulder joint, `abductionDeg` away
   * from hanging straight down.
   *
   * Drawn the way an arm is actually attached, which matters more than it
   * sounds: the fixture this replaces drew two arms parallel to the torso with
   * a constant strip of background between them and it all the way from the
   * shoulder to the hip. No body does that - a real arm is fused to the deltoid
   * and only comes away from the trunk further down - and a clearance check
   * that in practice passed nothing but an exaggerated T-pose looked perfectly
   * correct against it.
   */
  arm?: { halfWidth: number; abductionDeg: number };
  width?: number;
  height?: number;
  centre?: number;
}

/** Half-width at a stature fraction, linearly interpolated between control points. */
function halfWidthAt(profile: FigureSpec["profile"], fraction: number): number {
  const sorted = [...profile].sort((a, b) => a.at - b.at);
  if (fraction <= sorted[0].at) return sorted[0].halfWidth;
  const last = sorted[sorted.length - 1];
  if (fraction >= last.at) return last.halfWidth;
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (fraction > b.at) continue;
    const t = (fraction - a.at) / (b.at - a.at);
    return a.halfWidth + t * (b.halfWidth - a.halfWidth);
  }
  return last.halfWidth;
}

function figure(spec: FigureSpec): Silhouette {
  const width = spec.width ?? FRAME.width;
  const height = spec.height ?? FRAME.height;
  const centre = spec.centre ?? Math.floor(width / 2);
  const mask = new Uint8Array(width * height);
  const stature = spec.bottom - spec.top;

  for (let y = spec.top; y <= spec.bottom; y += 1) {
    const fraction = stature === 0 ? 0 : (y - spec.top) / stature;
    const half = Math.round(halfWidthAt(spec.profile, fraction));
    for (let x = centre - half; x <= centre + half; x += 1) {
      if (x >= 0 && x < width) mask[y * width + x] = 1;
    }
  }

  /* One arm each side, hinged at the shoulder and fused to the torso there, so
     the whole thing is one connected body - which is what a segmentation step
     hands the estimator. Where the arm comes away from the trunk, and how far
     down it reaches, follow from the angle rather than being drawn in. */
  if (spec.arm) {
    const { halfWidth: armHalf, abductionDeg } = spec.arm;
    const rad = (abductionDeg * Math.PI) / 180;
    const shoulderY = spec.top + BODY_LANDMARKS.shoulder * stature;
    const shoulderHalf = halfWidthAt(spec.profile, BODY_LANDMARKS.shoulder);
    const length = (ARM_SEGMENT.upper + ARM_SEGMENT.fore + ARM_SEGMENT.hand) * stature;
    for (const side of [-1, 1]) {
      const jointX = centre + side * Math.max(0, shoulderHalf - armHalf);
      /* Across the arm's own axis, so it is as thick at ninety degrees as it is
         hanging straight down. */
      const acrossX = side * Math.cos(rad);
      const acrossY = -Math.sin(rad);
      for (let along = 0; along <= length; along += 0.3) {
        const px = jointX + side * along * Math.sin(rad);
        const py = shoulderY + along * Math.cos(rad);
        for (let across = -armHalf; across <= armHalf; across += 0.3) {
          const x = Math.round(px + acrossX * across);
          const y = Math.round(py + acrossY * across);
          if (x >= 0 && x < width && y >= 0 && y < height) mask[y * width + x] = 1;
        }
      }
    }
  }
  return { width, height, mask };
}

/** A well-captured front view: whole body in frame, arms clear of the torso. */
const specOf = (): FigureSpec => ({
  top: 40,
  bottom: 360,
  arm: { halfWidth: 5, abductionDeg: 35 },
  profile: [
    { at: 0, halfWidth: 14 },
    { at: REGION_LEVEL.neckCm, halfWidth: 9 },
    /* Shoulders wider than the waist, so the arms hinge from outside the trunk
       the way they do on a body. Interpolating the shoulder line from the neck
       and the chest instead put the joint well inside the waist, and no amount
       of abduction could then clear it. */
    { at: BODY_LANDMARKS.shoulder, halfWidth: 30 },
    { at: REGION_LEVEL.chestCm, halfWidth: 26 },
    { at: REGION_LEVEL.waistCm, halfWidth: 22 },
    { at: REGION_LEVEL.hipCm, halfWidth: 27 },
    { at: REGION_LEVEL.thighCm, halfWidth: 24 },
    { at: REGION_LEVEL.calfCm, halfWidth: 14 },
    { at: 1, halfWidth: 10 },
  ],
});

/** The same body turned ninety degrees: shallower than it is wide. */
const sideSpecOf = (): FigureSpec => ({
  top: 40,
  bottom: 360,
  profile: [
    { at: 0, halfWidth: 16 },
    { at: REGION_LEVEL.neckCm, halfWidth: 9 },
    { at: BODY_LANDMARKS.shoulder, halfWidth: 20 },
    { at: REGION_LEVEL.chestCm, halfWidth: 18 },
    { at: REGION_LEVEL.waistCm, halfWidth: 16 },
    { at: REGION_LEVEL.hipCm, halfWidth: 20 },
    { at: REGION_LEVEL.thighCm, halfWidth: 17 },
    { at: REGION_LEVEL.calfCm, halfWidth: 11 },
    { at: 1, halfWidth: 12 },
  ],
});

const goodFront = () => figure(specOf());
const goodSide = () => figure(sideSpecOf());

/** A stance, by how far the arms are held out from hanging straight down. */
const stance = (abductionDeg: number) => figure({ ...specOf(), arm: { halfWidth: 5, abductionDeg } });
/** Arms flat against the body: no gap anywhere, nothing to measure a trunk by. */
const armsFlat = () => stance(0);
/** Arms a little away from the body, the way someone stands to be photographed. */
const naturalStance = () => stance(10);
/** Arms held straight out: the pose this used to demand. */
const tPose = () => stance(90);

describe("rowSpans and bodyExtent", () => {
  it("finds the vertical extent of the body, not of the frame", () => {
    const extent = bodyExtent(rowSpans(goodFront()));
    expect(extent).not.toBeNull();
    expect(extent!.top).toBe(40);
    expect(extent!.bottom).toBe(360);
    expect(extent!.heightPx).toBe(321);
  });

  it("returns null for a frame with nobody in it", () => {
    expect(bodyExtent(rowSpans({ width: 10, height: 10, mask: new Uint8Array(100) }))).toBeNull();
  });

  it("counts filled pixels separately from the extent, so a gap is visible", () => {
    /* Two legs with a gap: the extent spans both, `filled` counts only body. */
    const mask = new Uint8Array(20);
    mask[2] = 1;
    mask[3] = 1;
    mask[8] = 1;
    mask[9] = 1;
    const [span] = rowSpans({ width: 20, height: 1, mask });
    expect(span.left).toBe(2);
    expect(span.right).toBe(9);
    expect(span.filled).toBe(4);
  });
});

describe("levelRow", () => {
  it("places the crown at 0 and the sole at 1", () => {
    const extent = { top: 40, bottom: 360, heightPx: 321 };
    expect(levelRow(extent, 0)).toBe(40);
    expect(levelRow(extent, 1)).toBe(360);
  });

  it("never indexes past the body", () => {
    const extent = { top: 0, bottom: 9, heightPx: 10 };
    expect(levelRow(extent, 1.5)).toBe(9);
    expect(levelRow(extent, -1)).toBe(0);
  });
});

describe("widthAt", () => {
  it("measures the torso through the arms, not from one arm to the other", () => {
    const spans = rowSpans(goodFront());
    const extent = bodyExtent(spans)!;
    const row = levelRow(extent, REGION_LEVEL.waistCm);

    /* Half-width 22 either side of the centre column, inclusive. */
    expect(widthAt(spans, row, 5, "central")).toBe(45);
    /* The same row measured edge to edge spans the arms as well, which is why
       a torso level cannot use it. */
    expect(widthAt(spans, row, 5, "extent")).toBeGreaterThan(60);
  });

  it("smooths over a band rather than trusting one ragged row", () => {
    const spans = rowSpans(goodFront());
    const extent = bodyExtent(spans)!;
    const row = levelRow(extent, REGION_LEVEL.calfCm);
    /* A calf level has no arms across it, so every mode agrees there. */
    expect(widthAt(spans, row, 5, "central")).toBeGreaterThan(0);
  });

  it("is zero where there is no body", () => {
    expect(widthAt(rowSpans({ width: 4, height: 4, mask: new Uint8Array(16) }), 2, 3)).toBe(0);
  });
});

describe("centralRunWidth", () => {
  it("picks the run the body's centre line passes through", () => {
    /* An arm, a gap, the torso, a gap, an arm. */
    const mask = new Uint8Array(21);
    for (const [from, to] of [[1, 2], [7, 13], [18, 19]]) {
      for (let x = from; x <= to; x += 1) mask[x] = 1;
    }
    const [span] = rowSpans({ width: 21, height: 1, mask });
    expect(centralRunWidth(span)).toBe(7);
  });

  it("falls back to the widest run when the centre lands in a gap", () => {
    const mask = new Uint8Array(21);
    for (const [from, to] of [[1, 8], [14, 16]]) {
      for (let x = from; x <= to; x += 1) mask[x] = 1;
    }
    const [span] = rowSpans({ width: 21, height: 1, mask });
    expect(centralRunWidth(span)).toBe(8);
  });

  it("is zero on an empty row", () => {
    const [span] = rowSpans({ width: 8, height: 1, mask: new Uint8Array(8) });
    expect(centralRunWidth(span)).toBe(0);
  });
});

describe("armClearance", () => {
  const clearanceOf = (front: Silhouette) => {
    const spans = rowSpans(front);
    const extent = bodyExtent(spans)!;
    return armClearance(spans, extent, Math.max(3, Math.round(extent.heightPx / 170)));
  };

  it("leaves every level alone when the arms are held well clear", () => {
    expect(clearanceOf(stance(35)).obscured).toEqual([]);
  });

  it("reads arms held straight out as raised, clear of the whole torso", () => {
    const clearance = clearanceOf(tPose());
    expect(clearance.raised).toBe(true);
    expect(clearance.obscured).toEqual([]);
  });

  /* The bug this whole model replaces. The old check asked for a gap at one row
     halfway between the shoulder and the armpit - above the armpit, where an
     arm is joined to the deltoid whatever it is doing - so a natural stance was
     rejected outright and only a near-T-pose ever passed. */
  it("accepts a natural stance, naming only the level the arm still crosses", () => {
    const clearance = clearanceOf(naturalStance());
    expect(clearance.obscured).toContain("chestCm");
    expect(clearance.obscured).not.toContain("waistCm");
    expect(clearance.obscured).not.toContain("hipCm");
  });

  it("obscures nothing above the shoulder or below a whole arm's reach", () => {
    /* A neck is above the shoulder line and a calf below the fingertips: no
       pose puts an arm on either row. */
    for (const abduction of [0, 10, 35, 90]) {
      expect(clearanceOf(stance(abduction)).obscured).not.toContain("neckCm");
      expect(clearanceOf(stance(abduction)).obscured).not.toContain("calfCm");
    }
  });

  it("does not blame the arms for a level they end above", () => {
    /* Held out at sixty degrees the hands stop short of the hip. Taking a whole
       arm's length as the reach would demand a gap on a row no arm touches, and
       report the hip as obscured by an arm that is nowhere near it. */
    expect(clearanceOf(stance(60)).obscured).not.toContain("hipCm");
  });

  it("obscures a thigh a hand hangs beside, which halving a row would count as leg", () => {
    expect(clearanceOf(naturalStance()).obscured).toContain("thighCm");
    expect(clearanceOf(stance(35)).obscured).not.toContain("thighCm");
  });
});

describe("ellipsePerimeter", () => {
  it("degrades to a circle when the axes are equal", () => {
    expect(ellipsePerimeter(10, 10)).toBeCloseTo(2 * Math.PI * 10, 6);
  });

  it("matches a known ellipse perimeter", () => {
    /* a=5, b=3: the true perimeter is 25.527, and Ramanujan is exact to ~1e-5. */
    expect(ellipsePerimeter(5, 3)).toBeCloseTo(25.527, 2);
  });

  it("is zero for a degenerate axis", () => {
    expect(ellipsePerimeter(0, 0)).toBe(0);
  });
});

describe("assessCapture", () => {
  it("accepts a well-framed pair", () => {
    expect(assessCapture(goodFront(), goodSide())).toEqual({ accepted: true, reasons: [] });
  });

  it("rejects an empty frame naming which view was empty", () => {
    const empty = { width: FRAME.width, height: FRAME.height, mask: new Uint8Array(FRAME.width * FRAME.height) };
    expect(assessCapture(empty, goodSide()).reasons).toContain("front-empty");
    expect(assessCapture(goodFront(), empty).reasons).toContain("side-empty");
  });

  it("rejects a body running off the top or the bottom of the frame", () => {
    const cutTop = figure({ ...specOf(), top: 0, bottom: 360 });
    expect(assessCapture(cutTop, goodSide()).reasons).toContain("cut-off-top");
    const cutBottom = figure({ ...specOf(), top: 40, bottom: 399 });
    expect(assessCapture(cutBottom, goodSide()).reasons).toContain("cut-off-bottom");
  });

  it("rejects someone standing too far away to measure", () => {
    const small = figure({ ...specOf(), top: 150, bottom: 250 });
    expect(assessCapture(small, goodSide()).reasons).toContain("too-small");
  });

  it("rejects two views that disagree about stature", () => {
    const shorter = figure({ ...specOf(), top: 100, bottom: 330 });
    expect(assessCapture(goodFront(), shorter).reasons).toContain("height-mismatch");
  });

  it("rejects arms flat against the body, where no trunk width is observable", () => {
    const quality = assessCapture(armsFlat(), goodSide());
    expect(quality.accepted).toBe(false);
    expect(quality.reasons).toContain("arms-touching");
    /* One reason, not a list of every level it cost: the capture has to be
       retaken and naming three rows would not change what to do about it. */
    expect(quality.reasons.filter((reason) => reason.startsWith("arm-obscured-"))).toEqual([]);
  });

  it("rejects a body with no arms distinguishable from its trunk", () => {
    const noArms = figure({ ...specOf(), arm: undefined });
    expect(assessCapture(noArms, goodSide()).reasons).toContain("arms-touching");
  });

  it("accepts a natural stance and reports the level the arm crossed", () => {
    const quality = assessCapture(naturalStance(), goodSide());
    /* Accepted: a level the arms cross is a missing row, not a bad photograph,
       and the levels that were readable are no less trustworthy for it. */
    expect(quality.accepted).toBe(true);
    expect(quality.reasons).toContain("arm-obscured-chest");
  });

  it("accepts arms held straight out, which used to be the only pose that worked", () => {
    expect(assessCapture(tPose(), goodSide())).toEqual({ accepted: true, reasons: [] });
  });

  it("rejects a silhouette that has merged with its background", () => {
    const blob = figure({
      top: 40,
      bottom: 360,
      arm: { halfWidth: 5, abductionDeg: 35 },
      profile: [{ at: 0, halfWidth: 130 }, { at: 1, halfWidth: 130 }],
    });
    expect(assessCapture(blob, goodSide()).reasons).toContain("background-busy");
  });
});

describe("estimateCircumferences", () => {
  const heightCm = 176;

  it("produces no measurements at all from a rejected capture", () => {
    const empty = { width: FRAME.width, height: FRAME.height, mask: new Uint8Array(FRAME.width * FRAME.height) };
    const result = estimateCircumferences({ front: empty, side: goodSide(), heightCm });
    expect(result.quality.accepted).toBe(false);
    expect(result.measurements).toEqual([]);
  });

  it("estimates a waist within a centimetre of the drawn ellipse", () => {
    const result = estimateCircumferences({ front: goodFront(), side: goodSide(), heightCm });
    const waist = result.measurements.find((m) => m.region === "waistCm");
    expect(waist).toBeDefined();

    /* Ground truth: the figure is drawn 45 px across and 33 px deep at the
       waist, over a 321 px stature representing 176 cm. */
    const cmPerPx = heightCm / 321;
    const expected = ellipsePerimeter((45 * cmPerPx) / 2, (33 * cmPerPx) / 2);
    expect(waist!.valueCm).toBeCloseTo(expected, 0);
  });

  it("leaves out a level the arms cross and keeps the rest", () => {
    const result = estimateCircumferences({ front: naturalStance(), side: goodSide(), heightCm });
    expect(result.quality.accepted).toBe(true);
    const measured = result.measurements.map((measurement) => measurement.region);
    expect(measured).not.toContain("chestCm");
    expect(measured).toContain("waistCm");
    expect(measured).toContain("hipCm");
  });

  it("reads the same trunk whether the arms are barely out or straight out", () => {
    /* The point of dropping a level rather than the capture: what survives has
       to be the same number either way, or accepting a natural stance would be
       trading a rejection for a quietly wrong answer. */
    const natural = estimateCircumferences({ front: naturalStance(), side: goodSide(), heightCm });
    const wide = estimateCircumferences({ front: tPose(), side: goodSide(), heightCm });
    const waistOf = (result: typeof natural) =>
      result.measurements.find((measurement) => measurement.region === "waistCm")!.valueCm;
    expect(waistOf(natural)).toBeCloseTo(waistOf(wide), 1);
  });

  it("brackets every value with an interval that contains it", () => {
    const result = estimateCircumferences({ front: goodFront(), side: goodSide(), heightCm });
    expect(result.measurements.length).toBeGreaterThan(0);
    for (const measurement of result.measurements) {
      expect(measurement.lowerCm).toBeLessThan(measurement.valueCm);
      expect(measurement.upperCm).toBeGreaterThan(measurement.valueCm);
    }
  });

  it("halves a paired-limb width, so a thigh is one leg and not two", () => {
    const result = estimateCircumferences({ front: goodFront(), side: goodSide(), heightCm });
    const thigh = result.measurements.find((m) => m.region === "thighCm")!;
    const hip = result.measurements.find((m) => m.region === "hipCm")!;
    /* A thigh that had counted both legs would come out near the hip. */
    expect(thigh.valueCm).toBeLessThan(hip.valueCm * 0.8);
  });

  it("scales with declared height, because stature is the only scale there is", () => {
    const short = estimateCircumferences({ front: goodFront(), side: goodSide(), heightCm: 150 });
    const tall = estimateCircumferences({ front: goodFront(), side: goodSide(), heightCm: 200 });
    const waistOf = (r: typeof short) => r.measurements.find((m) => m.region === "waistCm")!.valueCm;
    expect(waistOf(tall) / waistOf(short)).toBeCloseTo(200 / 150, 2);
  });

  it("is unchanged by image resolution, because stature sets the scale", () => {
    /* The same body photographed at half the resolution is the same body. The
       subject still fills the frame - standing further away is a rejected
       capture, not a scale to be corrected for. */
    const near = estimateCircumferences({ front: goodFront(), side: goodSide(), heightCm });
    const half = (spec: FigureSpec): FigureSpec => ({
      ...spec,
      width: FRAME.width / 2,
      height: FRAME.height / 2,
      top: spec.top / 2,
      bottom: spec.bottom / 2,
      arm: spec.arm ? { ...spec.arm, halfWidth: spec.arm.halfWidth / 2 } : undefined,
      profile: spec.profile.map((p) => ({ ...p, halfWidth: p.halfWidth / 2 })),
    });
    const far = estimateCircumferences({
      front: figure(half(specOf())),
      side: figure(half(sideSpecOf())),
      heightCm,
    });
    expect(far.quality.accepted).toBe(true);

    const waistOf = (r: typeof near) => r.measurements.find((m) => m.region === "waistCm")!.valueCm;
    /* Within 3 cm: half the pixels is half the precision a rounded edge has. */
    expect(Math.abs(waistOf(near) - waistOf(far))).toBeLessThan(3);
  });
});
