import { describe, expect, it } from "vitest";
import {
  REGION_LEVEL,
  armsAreClear,
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

const FRAME = { width: 200, height: 400 } as const;

interface FigureSpec {
  /** Rows of the frame the body occupies, top and bottom inclusive. */
  top: number;
  bottom: number;
  /** Half-width in pixels at a fraction of stature, interpolated between entries. */
  profile: { at: number; halfWidth: number }[];
  /** Half-width of each arm, placed clear of the torso above the armpit. */
  armHalfWidth?: number;
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
    /* Arms hang outside the torso with a gap of background between, and join it
       at the shoulder the way a real one does - so they are one connected body,
       which is what segmentation will hand the estimator. */
    if (spec.armHalfWidth && fraction >= 0.16 && fraction <= 0.5) {
      const gap = fraction < 0.19 ? 0 : 4;
      for (const side of [-1, 1]) {
        const inner = centre + side * (half + gap);
        for (let i = 0; i <= spec.armHalfWidth * 2; i += 1) {
          const x = Math.round(inner + side * i);
          if (x >= 0 && x < width) mask[y * width + x] = 1;
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
  armHalfWidth: 5,
  profile: [
    { at: 0, halfWidth: 14 },
    { at: REGION_LEVEL.neckCm, halfWidth: 9 },
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

describe("armsAreClear", () => {
  it("sees the gap between the arms and the body", () => {
    const spans = rowSpans(goodFront());
    expect(armsAreClear(spans, bodyExtent(spans)!, 5)).toBe(true);
  });

  it("reports arms held against the body, where no gap exists", () => {
    const spans = rowSpans(figure({ ...specOf(), armHalfWidth: undefined }));
    expect(armsAreClear(spans, bodyExtent(spans)!, 5)).toBe(false);
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
    const empty = { width: 200, height: 400, mask: new Uint8Array(80000) };
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

  it("rejects arms held against the body, which no width can separate", () => {
    const armsDown = figure({ ...specOf(), armHalfWidth: undefined });
    expect(assessCapture(armsDown, goodSide()).reasons).toContain("arms-touching");
  });

  it("rejects a silhouette that has merged with its background", () => {
    const blob = figure({
      top: 40,
      bottom: 360,
      armHalfWidth: 5,
      profile: [{ at: 0, halfWidth: 95 }, { at: 1, halfWidth: 95 }],
    });
    expect(assessCapture(blob, goodSide()).reasons).toContain("background-busy");
  });
});

describe("estimateCircumferences", () => {
  const heightCm = 176;

  it("produces no measurements at all from a rejected capture", () => {
    const empty = { width: 200, height: 400, mask: new Uint8Array(80000) };
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
      armHalfWidth: spec.armHalfWidth ? spec.armHalfWidth / 2 : undefined,
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
