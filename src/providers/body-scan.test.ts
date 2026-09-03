import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { SilhouetteBodyScanProvider } from "./body-scan";
import { BODY_LANDMARKS } from "@/lib/body-visualization";
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

/** Draws a body on a plain wall and encodes it the way a phone would. */
async function render(profile: Profile, armHalfWidthPx: number): Promise<Buffer> {
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
    /* Arms held clear of the torso but joined at the shoulder, as the capture
       instructions ask for and as a real body is: one connected silhouette
       with a gap of background either side of the trunk. */
    if (armHalfWidthPx > 0 && fraction >= BODY_LANDMARKS.shoulder - 0.02 && fraction <= 0.5) {
      const gap = fraction < BODY_LANDMARKS.shoulder + 0.01 ? 0 : 14;
      for (const side of [-1, 1]) {
        const inner = centre + side * (half + gap);
        for (let k = 0; k <= armHalfWidthPx * 2; k += 1) put(Math.round(inner + side * k), y);
      }
    }
  }
  return sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}

const frontProfile: Profile = [
  { at: 0, halfWidthPx: px(15) },
  { at: BODY_LANDMARKS.neckBase, halfWidthPx: px(TRUTH.neckCm.breadth) / 2 },
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
