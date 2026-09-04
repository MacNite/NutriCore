import { describe, expect, it } from "vitest";
import { BODY_METRICS, emptyMeasurement, type BodyMeasurement } from "./body-metrics";
import {
  BODY_FIGURES,
  BODY_LANDMARKS,
  BODY_REGIONS,
  BODY_SHAPE_STYLES,
  BODY_TYPES,
  BODY_VIEW,
  MEASURE_ROW_GAP,
  MEASURE_VIEW,
  bodyMeasureRows,
  DEFAULT_APPEARANCE,
  DIAMOND,
  axisRatio,
  baselineInput,
  bodyRegionGeometry,
  buildBodyFigure,
  buildBodyOutline,
  changeIntensity,
  clipShapes,
  outlineInput,
  outlineShapes,
  polarPoint,
  radiusForRatio,
  anyPanel,
  panelMetrics,
  type BodyAppearance,
} from "./body-visualization";

const appearance = DEFAULT_APPEARANCE;
const measured: BodyMeasurement = {
  ...emptyMeasurement("2026-09-02"),
  neckCm: 38.8,
  chestCm: 103.2,
  waistCm: 84.2,
  hipCm: 100.9,
  upperArmLeftCm: 34.5,
  upperArmRightCm: 35.1,
  thighLeftCm: 59.6,
  thighRightCm: 60.4,
  calfLeftCm: 38.6,
  calfRightCm: 39,
};
const input = outlineInput(measured, appearance);

/**
 * Every coordinate pair in a path, control points included. An arc's leading
 * radius pair and flags are dropped first, or they would read as a point.
 */
const pointsOf = (path: string) =>
  [...path.replace(/A[\d.]+,[\d.]+ 0 [01] [01] /g, "").matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(
    ([, x, y]) => ({ x: Number(x), y: Number(y) }),
  );

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

describe("the chosen build", () => {
  it("gives each somatotype different proportions", () => {
    const waists = BODY_TYPES.map((type) => baselineInput({ type, figure: "NEUTRAL" }).waistCm);
    expect(new Set(waists).size).toBe(BODY_TYPES.length);
    const [ecto, meso, endo] = waists;
    expect(ecto).toBeLessThan(meso);
    expect(meso).toBeLessThan(endo);
  });

  it("gives each presentation a different waist-to-hip shape", () => {
    const ratios = BODY_FIGURES.map((figure) => {
      const base = baselineInput({ type: "MESOMORPH", figure });
      return base.waistCm / base.hipCm;
    });
    expect(new Set(ratios.map((value) => value.toFixed(3))).size).toBe(BODY_FIGURES.length);
  });

  it("is only a fallback: a recorded circumference always wins", () => {
    expect(outlineInput(measured, appearance).waistCm).toBe(84.2);
    const partial = { ...emptyMeasurement("x"), waistCm: 70 };
    const resolved = outlineInput(partial, appearance);
    expect(resolved.waistCm).toBe(70);
    expect(resolved.chestCm).toBe(baselineInput(appearance).chestCm);
  });

  it("averages a measured pair and falls back per limb", () => {
    const partial = { ...emptyMeasurement("x"), thighLeftCm: 60, thighRightCm: 62 };
    expect(outlineInput(partial, appearance).thighCm).toBe(61);
    expect(outlineInput(partial, appearance).calfCm).toBe(baselineInput(appearance).calfCm);
  });
});

describe("the silhouette", () => {
  const outline = buildBodyOutline(input, appearance);

  it("is one closed path, so the arms carry no seam across them", () => {
    expect(outlineShapes(outline)).toHaveLength(1);
    expect(outline.silhouette.startsWith("M")).toBe(true);
    expect(outline.silhouette.trimEnd().endsWith("Z")).toBe(true);
    expect(outline.silhouette).not.toContain("NaN");
  });

  it("starts on the centre line, so its two halves join", () => {
    expect(Number(outline.silhouette.slice(1).split(",")[0])).toBeCloseTo(BODY_VIEW.cx, 1);
  });

  it("stays inside the drawing area for every build", () => {
    for (const type of BODY_TYPES) {
      for (const figure of BODY_FIGURES) {
        const option: BodyAppearance = { type, figure };
        const shape = buildBodyOutline(baselineInput(option), option).silhouette;
        for (const point of pointsOf(shape)) {
          expect(point.x).toBeGreaterThan(0);
          expect(point.x).toBeLessThan(BODY_VIEW.width);
          expect(point.y).toBeGreaterThan(0);
          expect(point.y).toBeLessThan(BODY_VIEW.height);
        }
      }
    }
  });

  it("is symmetric about the centre line", () => {
    const xs = pointsOf(outline.silhouette).map((point) => point.x);
    const span = Math.max(...xs) + Math.min(...xs);
    expect(span).toBeCloseTo(2 * BODY_VIEW.cx, 0);
  });

  it("narrows the waist when the recorded waist shrinks", () => {
    const waistWidth = (waistCm: number) =>
      bodyRegionGeometry(outlineInput({ ...measured, waistCm }, appearance), appearance).find(
        (region) => region.key === "waist",
      )!.rects[0].width;
    expect(waistWidth(78)).toBeLessThan(waistWidth(96));
  });

  it("widens the shoulders for a mesomorph build", () => {
    const span = (type: (typeof BODY_TYPES)[number]) => {
      const option: BodyAppearance = { type, figure: "NEUTRAL" };
      const xs = pointsOf(buildBodyOutline(input, option).silhouette).map((point) => point.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span("MESOMORPH")).toBeGreaterThan(span("ECTOMORPH"));
  });

  it("keeps clip shapes that are never drawn", () => {
    expect(clipShapes(outline, "body")).toEqual([outline.torso]);
    expect(clipShapes(outline, "arms")).toEqual(outline.arms);
    expect(outlineShapes(outline)).not.toContain(outline.torso);
  });
});

describe("figure art", () => {
  it("draws hair on every figure and long hair only where the style has it", () => {
    for (const figure of BODY_FIGURES) {
      const option: BodyAppearance = { type: "MESOMORPH", figure };
      const art = buildBodyFigure(baselineInput(option), option);
      expect(art.hairFront).toContain("A");
      expect(art.hairBack === null).toBe(figure !== "FEMININE");
    }
  });

  it("draws a bra only on the feminine figure", () => {
    for (const figure of BODY_FIGURES) {
      const option: BodyAppearance = { type: "MESOMORPH", figure };
      expect(buildBodyFigure(baselineInput(option), option).bra === null).toBe(figure !== "FEMININE");
    }
  });

  it("always draws underwear and interior lines", () => {
    const art = buildBodyFigure(input, appearance);
    expect(art.briefs).not.toContain("NaN");
    expect(art.contours.length).toBeGreaterThanOrEqual(3);
    expect(art.contours.join(" ")).not.toContain("NaN");
  });
});

describe("region bands", () => {
  const regions = bodyRegionGeometry(input, appearance);

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

describe("metrics behind the panel switches", () => {
  it("lists everything while both panels are on", () => {
    expect(panelMetrics({ composition: true, shape: true })).toEqual(BODY_METRICS.map((def) => def.key));
  });

  it("drops the composition axes with the composition panel", () => {
    const metrics = panelMetrics({ composition: false, shape: true });
    expect(metrics).not.toContain("bodyFatPct");
    expect(metrics).not.toContain("muscleKg");
    expect(metrics).not.toContain("bodyWaterPct");
    expect(metrics).not.toContain("boneKg");
    expect(metrics).toContain("waistCm");
  });

  it("drops every circumference with the shape panel", () => {
    const metrics = panelMetrics({ composition: true, shape: false });
    expect(metrics.filter((key) => key.endsWith("Cm"))).toEqual([]);
    expect(metrics).toContain("bodyFatPct");
  });

  /* Weight rides along with whatever panel is left rather than owning a
     switch of its own. */
  it("keeps weight for as long as either panel is on", () => {
    expect(panelMetrics({ composition: true, shape: false })).toContain("weightKg");
    expect(panelMetrics({ composition: false, shape: true })).toContain("weightKg");
  });

  it("leaves nothing at all once both are off, which is what removes the section", () => {
    expect(panelMetrics({ composition: false, shape: false })).toEqual([]);
    expect(anyPanel({ composition: false, shape: false })).toBe(false);
  });
});

/**
 * The proportions are the one part of the drawing that is answerable to
 * something outside it, so they are asserted against the published table rather
 * than against whatever the curves happen to look like.
 */
describe("canonical proportions", () => {
  it("puts every landmark where anthropometry puts it", () => {
    const expected: Record<string, number> = {
      chin: 0.13,
      shoulder: 0.183,
      chest: 0.28,
      waist: 0.38,
      hip: 0.478,
      crotch: 0.515,
      knee: 0.715,
      ankle: 0.955,
    };
    for (const [landmark, fraction] of Object.entries(expected)) {
      expect(BODY_LANDMARKS[landmark as keyof typeof BODY_LANDMARKS]).toBeCloseTo(fraction, 3);
    }
  });

  it("reads top to bottom, with the crotch at the middle of the body", () => {
    const fractions = Object.values(BODY_LANDMARKS);
    for (let index = 0; index < fractions.length - 1; index += 1) {
      expect(fractions[index]).toBeLessThan(fractions[index + 1]);
    }
    /* Half of standing height is the classical midpoint, and the reason the old
       figure read as long-bodied: its crotch sat at 0.62. */
    expect(BODY_LANDMARKS.crotch).toBeGreaterThan(0.5);
    expect(BODY_LANDMARKS.crotch).toBeLessThan(0.53);
  });

  it("is between seven and eight heads tall", () => {
    expect(1 / BODY_LANDMARKS.chin).toBeGreaterThan(7);
    expect(1 / BODY_LANDMARKS.chin).toBeLessThan(8);
  });

  it("gives the legs close to half the standing height", () => {
    expect(1 - BODY_LANDMARKS.crotch).toBeGreaterThan(0.45);
  });
});

describe("the two shape styles", () => {
  it("holds the arms further out for the measure figure", () => {
    const span = (style: (typeof BODY_SHAPE_STYLES)[number]) => {
      const xs = pointsOf(buildBodyOutline(input, appearance, style).silhouette).map((point) => point.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span("MEASURE")).toBeGreaterThan(span("SILHOUETTE"));
  });

  it("keeps both styles inside their own drawing area", () => {
    for (const style of BODY_SHAPE_STYLES) {
      const view = style === "MEASURE" ? MEASURE_VIEW : BODY_VIEW;
      for (const point of pointsOf(buildBodyOutline(input, appearance, style).silhouette)) {
        expect(point.x).toBeGreaterThan(0);
        expect(point.x).toBeLessThan(view.width);
        expect(point.y).toBeGreaterThan(0);
        expect(point.y).toBeLessThan(view.height);
      }
    }
  });

  it("draws the same body either way, only posed differently", () => {
    const waist = (style: (typeof BODY_SHAPE_STYLES)[number]) =>
      bodyRegionGeometry(input, appearance, style).find((region) => region.key === "waist")!.rects[0];
    expect(waist("MEASURE")).toEqual(waist("SILHOUETTE"));
  });
});

describe("measure figure calipers", () => {
  const rows = bodyMeasureRows(input, appearance);

  it("measures every recorded region, in reading order", () => {
    expect(rows.map((row) => row.key)).toEqual(BODY_REGIONS);
  });

  it("measures the torso across the centre line and the limbs on a limb", () => {
    for (const key of ["neck", "chest", "waist", "hip"] as const) {
      expect(rows.find((row) => row.key === key)!.cx).toBeCloseTo(BODY_VIEW.cx, 1);
    }
    for (const key of ["upperArm", "thigh", "calf"] as const) {
      expect(rows.find((row) => row.key === key)!.cx).toBeGreaterThan(BODY_VIEW.cx + 10);
    }
  });

  it("keeps every caliper clear of the label column", () => {
    for (const row of rows) {
      expect(row.cx - row.half).toBeGreaterThan(0);
      expect(row.cx + row.half).toBeLessThan(MEASURE_VIEW.labelX - 8);
    }
  });

  it("leaves room between labels for every build", () => {
    for (const type of BODY_TYPES) {
      for (const figure of BODY_FIGURES) {
        const option: BodyAppearance = { type, figure };
        const labels = bodyMeasureRows(baselineInput(option), option)
          .map((row) => row.labelY)
          .sort((a, b) => a - b);
        for (let index = 0; index < labels.length - 1; index += 1) {
          expect(labels[index + 1] - labels[index]).toBeGreaterThanOrEqual(MEASURE_ROW_GAP - 0.01);
        }
        expect(labels[labels.length - 1]).toBeLessThan(MEASURE_VIEW.height);
      }
    }
  });

  it("widens a caliper when the circumference it measures grows", () => {
    const waist = (waistCm: number) =>
      bodyMeasureRows(outlineInput({ ...measured, waistCm }, appearance), appearance).find(
        (row) => row.key === "waist",
      )!.half;
    expect(waist(96)).toBeGreaterThan(waist(78));
  });
});
