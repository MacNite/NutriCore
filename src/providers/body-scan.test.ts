import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { SilhouetteBodyScanProvider } from "./body-scan";
import { ARM_SEGMENT, BODY_LANDMARKS } from "@/lib/body-visualization";
import { ellipsePerimeter } from "@/lib/body-scan";

/**
 * End to end through the real provider: encoded images in, circumferences out.
 *
 * The unit tests work on masks, which skips the two steps most likely to be
 * wrong in practice - decoding with `sharp` and separating a body from a wall.
 * These draw a body of known dimensions, encode it as a PNG, and check that
 * what comes back is the body that was drawn. It is also the only test that
 * says anything about how long a scan takes on a CPU.
 */

const WIDTH = 720;
const HEIGHT = 1280;
const TOP = 80;
const BOTTOM = 1200;
const HEIGHT_CM = 176;
const CM_PER_PX = HEIGHT_CM / (BOTTOM - TOP + 1);
const px = (cm: number) => cm / CM_PER_PX;

const WALL: [number, number, number] = [235, 233, 230];
const BODY: [number, number, number] = [55, 62, 80];

/** Breadth and depth in centimetres at each measured level, as drawn. */
const TRUTH = {
  neckCm: { breadth: 12, depth: 12 },
  chestCm: { breadth: 30, depth: 21 },
  waistCm: { breadth: 27, depth: 19 },
  hipCm: { breadth: 34, depth: 23 },
  thighCm: { breadth: 17, depth: 17 },
  calfCm: { breadth: 11, depth: 11 },
} as const;

type Profile = { at: number; halfWidthPx: number }[];

function halfWidthAt(profile: Profile, fraction: number): number {
  const sorted = [...profile].sort((a, b) => a.at - b.at);
  if (fraction <= sorted[0].at) return sorted[0].halfWidthPx;
  const last = sorted[sorted.length - 1];
  if (fraction >= last.at) return last.halfWidthPx;
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (fraction > b.at) continue;
    return a.halfWidthPx + ((fraction - a.at) / (b.at - a.at)) * (b.halfWidthPx - a.halfWidthPx);
  }
  return last.halfWidthPx;
}

/**
 * Draws a body on a plain wall and encodes it the way a phone would.
 *
 * `armAbductionDeg` is how far the arms are held out from hanging straight
 * down. Which poses the clearance model accepts is settled by the unit tests on
 * masks; what this fixture has to be is anatomically possible, so that the
 * decode-and-threshold half of the pipeline is exercised on a body someone
 * could actually stand in.
 */
async function render(profile: Profile, armHalfWidthPx: number, armAbductionDeg = 25): Promise<Buffer> {
  const raw = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    raw[i * 3] = WALL[0];
    raw[i * 3 + 1] = WALL[1];
    raw[i * 3 + 2] = WALL[2];
  }
  const put = (x: number, y: number) => {
    if (x < 0 || x >= WIDTH) return;
    const i = (y * WIDTH + x) * 3;
    raw[i] = BODY[0];
    raw[i + 1] = BODY[1];
    raw[i + 2] = BODY[2];
  };

  const centre = WIDTH / 2;
  for (let y = TOP; y <= BOTTOM; y += 1) {
    const fraction = (y - TOP) / (BOTTOM - TOP);
    const half = Math.round(halfWidthAt(profile, fraction));
    for (let x = centre - half; x <= centre + half; x += 1) put(x, y);
  }

  /* Arms hinged at the shoulder and fused to the torso there, coming away from
     the trunk further down as a real one does - one connected silhouette. Drawn
     as a capsule from the joint rather than as a strip parallel to the torso:
     the strip left a gap of background from shoulder to hip on a body nobody
     has, and a clearance check that only ever passed an exaggerated T-pose
     looked correct against it. */
  if (armHalfWidthPx > 0) {
    const rad = (armAbductionDeg * Math.PI) / 180;
    const shoulderY = TOP + BODY_LANDMARKS.shoulder * (BOTTOM - TOP);
    /* On the drawn shoulder line, so the arm overlaps the torso there and the
       whole figure stays one connected component. Hinging it outside the widest
       part of the chest instead left it floating clear of a narrower shoulder,
       and the segmentation step - which keeps only the largest blob - threw
       both arms away. */
    const shoulderHalf = halfWidthAt(profile, BODY_LANDMARKS.shoulder);
    const length = (ARM_SEGMENT.upper + ARM_SEGMENT.fore + ARM_SEGMENT.hand) * (BOTTOM - TOP);
    for (const side of [-1, 1]) {
      const jointX = centre + side * (shoulderHalf - armHalfWidthPx);
      /* Across the arm's own axis, so it is as thick held out as hanging down. */
      const acrossX = side * Math.cos(rad);
      const acrossY = -Math.sin(rad);
      for (let along = 0; along <= length; along += 0.4) {
        const ax = jointX + side * along * Math.sin(rad);
        const ay = shoulderY + along * Math.cos(rad);
        for (let across = -armHalfWidthPx; across <= armHalfWidthPx; across += 0.4) {
          const y = Math.round(ay + acrossY * across);
          if (y >= 0 && y < HEIGHT) put(Math.round(ax + acrossX * across), y);
        }
      }
    }
  }
  return sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}

const frontProfile: Profile = [
  { at: 0, halfWidthPx: px(15) },
  { at: BODY_LANDMARKS.neckBase, halfWidthPx: px(TRUTH.neckCm.breadth) / 2 },
  /* The neck holds its width a little below the level it is measured at, so the
     smoothing band over that row never reaches the shoulder flare below. */
  { at: (BODY_LANDMARKS.neckBase + BODY_LANDMARKS.shoulder) / 2, halfWidthPx: px(TRUTH.neckCm.breadth) / 2 },
  /* A shoulder line of its own, wider than the chest, so the arms hang off the
     outside of the trunk. Interpolated from the neck and the chest instead, the
     shoulder came out narrower than the chest and the arms hinged from inside
     it, which no pose can hold clear. Not a measured level. */
  { at: BODY_LANDMARKS.shoulder, halfWidthPx: px(38) / 2 },
  { at: BODY_LANDMARKS.chest, halfWidthPx: px(TRUTH.chestCm.breadth) / 2 },
  { at: BODY_LANDMARKS.waist, halfWidthPx: px(TRUTH.waistCm.breadth) / 2 },
  { at: BODY_LANDMARKS.hip, halfWidthPx: px(TRUTH.hipCm.breadth) / 2 },
  /* Legs: the front view crosses both, so the drawn half-width is one leg. */
  { at: BODY_LANDMARKS.thigh, halfWidthPx: px(TRUTH.thighCm.breadth) },
  { at: BODY_LANDMARKS.calf, halfWidthPx: px(TRUTH.calfCm.breadth) },
  { at: 1, halfWidthPx: px(9) },
];

const sideProfile: Profile = [
  { at: 0, halfWidthPx: px(19) },
  { at: BODY_LANDMARKS.neckBase, halfWidthPx: px(TRUTH.neckCm.depth) / 2 },
  { at: BODY_LANDMARKS.chest, halfWidthPx: px(TRUTH.chestCm.depth) / 2 },
  { at: BODY_LANDMARKS.waist, halfWidthPx: px(TRUTH.waistCm.depth) / 2 },
  { at: BODY_LANDMARKS.hip, halfWidthPx: px(TRUTH.hipCm.depth) / 2 },
  { at: BODY_LANDMARKS.thigh, halfWidthPx: px(TRUTH.thighCm.depth) / 2 },
  { at: BODY_LANDMARKS.calf, halfWidthPx: px(TRUTH.calfCm.depth) / 2 },
  { at: 1, halfWidthPx: px(12) },
];

const capture = async () => ({
  front: { mime: "image/png", data: await render(frontProfile, px(4.5) / 2) },
  side: { mime: "image/png", data: await render(sideProfile, 0) },
  heightCm: HEIGHT_CM,
  weightKg: 74,
});

describe("SilhouetteBodyScanProvider", () => {
  it("recovers the circumferences of a body drawn to known dimensions", async () => {
    const result = await new SilhouetteBodyScanProvider().estimate(await capture());

    expect(result.quality.reasons).toEqual([]);
    expect(result.quality.accepted).toBe(true);
    const byRegion = new Map(result.measurements.map((m) => [m.region, m]));

    for (const [region, truth] of Object.entries(TRUTH)) {
      const expected = ellipsePerimeter(truth.breadth / 2, truth.depth / 2);
      const actual = byRegion.get(region as keyof typeof TRUTH);
      expect(actual, `${region} was not estimated`).toBeDefined();
      /* Within 2 cm of the drawn body, through PNG encoding, decoding,
         thresholding and resampling to the working resolution. */
      expect(Math.abs(actual!.valueCm - expected), `${region}: got ${actual!.valueCm}, drew ${expected.toFixed(1)}`)
        .toBeLessThan(2);
    }
  });

  it("accepts a natural stance and still reads the body it was drawn as", async () => {
    /* Arms ten degrees out from hanging straight: the stance someone actually
       adopts to be photographed, and one the old clearance check rejected
       outright in favour of an exaggerated T-pose. */
    const input = { ...(await capture()), front: { mime: "image/png", data: await render(frontProfile, px(4.5) / 2, 10) } };
    const result = await new SilhouetteBodyScanProvider().estimate(input);

    expect(result.quality.accepted).toBe(true);
    /* Whatever survives has to be the body that was drawn. Accepting a natural
       stance is only worth anything if it does not trade a rejection for a
       quietly wrong number. */
    for (const measurement of result.measurements) {
      const truth = TRUTH[measurement.region as keyof typeof TRUTH];
      const expected = ellipsePerimeter(truth.breadth / 2, truth.depth / 2);
      expect(Math.abs(measurement.valueCm - expected), `${measurement.region}: got ${measurement.valueCm}`)
        .toBeLessThan(2);
    }
    /* A hand hanging beside the thigh is counted as thigh by a halved row, so
       that one level is left out and said to be left out. */
    expect(result.quality.reasons).toContain("arm-obscured-thigh");
    expect(result.measurements.map((measurement) => measurement.region)).toContain("waistCm");
  });

  it("returns no numbers for arms flat against the body", async () => {
    const input = { ...(await capture()), front: { mime: "image/png", data: await render(frontProfile, px(4.5) / 2, 0) } };
    const result = await new SilhouetteBodyScanProvider().estimate(input);

    expect(result.quality.accepted).toBe(false);
    expect(result.quality.reasons).toContain("arms-touching");
    expect(result.measurements).toEqual([]);
  });

  it("brackets each value and reports which estimator produced it", async () => {
    const result = await new SilhouetteBodyScanProvider().estimate(await capture());

    expect(result.processor).toEqual({
      provider: "silhouette",
      model: "two-view-ellipse",
      version: SilhouetteBodyScanProvider.VERSION,
    });
    for (const measurement of result.measurements) {
      expect(measurement.lowerCm).toBeLessThan(measurement.valueCm);
      expect(measurement.upperCm).toBeGreaterThan(measurement.valueCm);
    }
  });

  it("returns no numbers when the body cannot be told from the wall", async () => {
    const input = await capture();
    /* A wall-coloured body: the documented failure mode of a threshold. */
    const blank = await sharp({
      create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: WALL[0], g: WALL[1], b: WALL[2] } },
    })
      .png()
      .toBuffer();

    const result = await new SilhouetteBodyScanProvider().estimate({ ...input, front: { mime: "image/png", data: blank } });
    expect(result.quality.accepted).toBe(false);
    expect(result.quality.reasons).toContain("front-empty");
    expect(result.measurements).toEqual([]);
  });

  it("rejects bytes that are not a decodable image", async () => {
    const input = await capture();
    await expect(
      new SilhouetteBodyScanProvider().estimate({ ...input, side: { mime: "image/png", data: Buffer.from("not an image") } }),
    ).rejects.toThrow(/could not be decoded|Input buffer/i);
  });

  it("runs on a CPU in a time a queued job can absorb", async () => {
    const input = await capture();
    const started = performance.now();
    await new SilhouetteBodyScanProvider().estimate(input);
    const elapsed = performance.now() - started;
    /* Generous, because CI hardware varies; the point is that this is seconds
       at worst and needs no GPU, not that it hits a particular number. */
    expect(elapsed).toBeLessThan(10_000);
    console.info(`body scan: ${elapsed.toFixed(0)} ms for two ${WIDTH}x${HEIGHT} images`);
  });
});
