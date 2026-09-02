import { describe, expect, it } from "vitest";
import {
  BODY_REGIONS,
  BODY_VIEW,
  DIAMOND,
  axisRatio,
  bodyRegionGeometry,
  buildBodyOutline,
  changeIntensity,
  outlineInput,
  outlineShapes,
  polarPoint,
  radiusForRatio,
} from "./body-visualization";
import { MOCK_MEASUREMENTS, MOCK_REFERENCE_INDEX } from "./body-mock-data";

const current = outlineInput(MOCK_MEASUREMENTS[MOCK_MEASUREMENTS.length - 1]);
const reference = outlineInput(MOCK_MEASUREMENTS[MOCK_REFERENCE_INDEX]);

describe("diamond scale", () => {
  it("puts an unchanged axis on the reference ring", () => {
    expect(radiusForRatio(1)).toBe(DIAMOND.baseRadius);
  });

  it("moves outward for growth and inward for shrinkage", () => {
    expect(radiusForRatio(1.05)).toBeGreaterThan(DIAMOND.baseRadius);
    expect(radiusForRatio(0.95)).toBeLessThan(DIAMOND.baseRadius);
  });

  it("clamps extreme ratios so the polygon stays inside the chart", () => {
    expect(radiusForRatio(4)).toBe(DIAMOND.maxRadius);
    expect(radiusForRatio(0)).toBe(DIAMOND.minRadius);
  });

  it("treats a missing value as unchanged rather than as zero", () => {
    expect(axisRatio(null, 20.6)).toBe(1);
    expect(axisRatio(18.4, null)).toBe(1);
    expect(axisRatio(18.4, 0)).toBe(1);
  });

  it("places the four axes at the compass points", () => {
    expect(polarPoint(-90, 10)).toEqual({ x: DIAMOND.cx, y: DIAMOND.cy - 10 });
    expect(polarPoint(0, 10).x).toBeCloseTo(DIAMOND.cx + 10);
    expect(polarPoint(180, 10).x).toBeCloseTo(DIAMOND.cx - 10);
  });
});

/** Every coordinate pair in a path, control points included. */
const pointsOf = (path: string) =>
  [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(([, x, y]) => ({
    x: Number(x),
    y: Number(y),
  }));

describe("body outline", () => {
  const outline = buildBodyOutline(current);

  it("produces one closed path per body part", () => {
    for (const path of outlineShapes(outline)) {
      expect(path.startsWith("M")).toBe(true);
      expect(path.trimEnd().endsWith("Z")).toBe(true);
      expect(path).not.toContain("NaN");
    }
  });

  it("mirrors the arms around the centre line", () => {
    const xOf = (path: string) => Number(path.slice(1).split(",")[0]);
    expect(xOf(outline.arms[0]) + xOf(outline.arms[1])).toBeCloseTo(2 * BODY_VIEW.cx, 1);
  });

  it("starts the body path on the centre line, so its two halves join", () => {
    expect(Number(outline.body.slice(1).split(",")[0])).toBeCloseTo(BODY_VIEW.cx, 1);
  });

  it("keeps the arms clear of the body outline at every height", () => {
    /* Compared band by band: an arm that crosses the torso would draw a seam
       through the silhouette, which is exactly what the single body path and
       the hanging arms exist to avoid. */
    const near = (points: { x: number; y: number }[], top: number) =>
      points.filter((point) => point.y >= top && point.y < top + 20).map((point) => point.x);
    const arm = pointsOf(outline.arms[1]);
    const body = pointsOf(outline.body);
    for (let top = 110; top < 290; top += 20) {
      const inner = near(arm, top);
      const outer = near(body, top);
      if (inner.length === 0 || outer.length === 0) continue;
      expect(Math.min(...inner)).toBeGreaterThan(Math.max(...outer));
    }
  });

  it("stays inside the drawing area", () => {
    for (const point of outlineShapes(outline).flatMap(pointsOf)) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(BODY_VIEW.width);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(BODY_VIEW.height);
    }
  });

  it("narrows the waist when the recorded waist shrinks", () => {
    const waistX = (input: typeof current) =>
      bodyRegionGeometry(input).find((region) => region.key === "waist")!.rects[0].width;
    expect(waistX(current)).toBeLessThan(waistX(reference));
  });
});

describe("region bands", () => {
  const regions = bodyRegionGeometry(current);

  it("covers every named region", () => {
    expect(regions.map((region) => region.key)).toEqual(BODY_REGIONS);
  });

  it("gives paired limbs one pointer target per side", () => {
    for (const key of ["upperArm", "thigh", "calf"] as const) {
      expect(regions.find((region) => region.key === key)!.hitRects).toHaveLength(2);
    }
  });

  it("clips each band to the group it describes", () => {
    expect(regions.find((region) => region.key === "waist")!.clip).toBe("body");
    expect(regions.find((region) => region.key === "thigh")!.clip).toBe("body");
    expect(regions.find((region) => region.key === "upperArm")!.clip).toBe("arms");
  });

  it("keeps the torso bands from overlapping each other vertically", () => {
    const stacked = ["neck", "chest", "waist", "hip"] as const;
    for (let index = 0; index < stacked.length - 1; index += 1) {
      const above = regions.find((region) => region.key === stacked[index])!.rects[0];
      const below = regions.find((region) => region.key === stacked[index + 1])!.rects[0];
      expect(above.y + above.height).toBeLessThanOrEqual(below.y);
    }
  });

  it("keeps the arm pointer targets clear of the widest torso band", () => {
    const arms = regions.find((region) => region.key === "upperArm")!.hitRects;
    const chest = regions.find((region) => region.key === "chest")!.hitRects[0];
    expect(arms[0].x + arms[0].width).toBeLessThanOrEqual(chest.x);
    expect(arms[1].x).toBeGreaterThanOrEqual(chest.x + chest.width);
  });
});

describe("change intensity", () => {
  it("is stronger for a larger relative change", () => {
    expect(changeIntensity(-6.4)).toBeGreaterThan(changeIntensity(1.2));
  });

  it("stays within a legible opacity band and ignores direction", () => {
    expect(changeIntensity(0)).toBeGreaterThan(0.1);
    expect(changeIntensity(-99)).toBeLessThanOrEqual(0.46);
    expect(changeIntensity(3)).toBeCloseTo(changeIntensity(-3));
  });

  it("returns nothing to draw when the change is unknown", () => {
    expect(changeIntensity(null)).toBe(0);
  });
});
