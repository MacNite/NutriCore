import { describe, expect, it } from "vitest";
import { backgroundColour, fillHoles, largestComponent, silhouetteFrom, type RgbImage } from "./silhouette";
import { bodyExtent, rowSpans } from "./body-scan";

/** A blank frame of one colour, to paint test shapes onto. */
function canvas(width: number, height: number, colour: [number, number, number]): RgbImage {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 3] = colour[0];
    data[i * 3 + 1] = colour[1];
    data[i * 3 + 2] = colour[2];
  }
  return { width, height, data };
}

function paint(image: RgbImage, x0: number, y0: number, x1: number, y1: number, colour: [number, number, number]) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * image.width + x) * 3;
      image.data[i] = colour[0];
      image.data[i + 1] = colour[1];
      image.data[i + 2] = colour[2];
    }
  }
}

const WALL: [number, number, number] = [230, 228, 225];
const BODY: [number, number, number] = [60, 70, 90];

describe("backgroundColour", () => {
  it("reads the wall from the border, not from the person in the middle", () => {
    const image = canvas(60, 100, WALL);
    paint(image, 20, 10, 40, 90, BODY);
    expect(backgroundColour(image)).toEqual({ r: WALL[0], g: WALL[1], b: WALL[2] });
  });

  it("is unmoved by a body that runs off the bottom edge", () => {
    const image = canvas(60, 100, WALL);
    paint(image, 20, 10, 40, 99, BODY);
    /* A median survives a contaminated border where a mean would drift. */
    expect(backgroundColour(image)).toEqual({ r: WALL[0], g: WALL[1], b: WALL[2] });
  });
});

describe("largestComponent", () => {
  it("keeps the body and discards a smaller distraction", () => {
    const width = 20;
    const height = 20;
    const mask = new Uint8Array(width * height);
    /* A tall blob and a small speck elsewhere. */
    for (let y = 2; y < 18; y += 1) for (let x = 8; x < 12; x += 1) mask[y * width + x] = 1;
    mask[0] = 1;
    mask[1] = 1;

    const kept = largestComponent(mask, width, height);
    expect(kept[0]).toBe(0);
    expect(kept[10 * width + 9]).toBe(1);
    expect(kept.reduce((sum, v) => sum + v, 0)).toBe(16 * 4);
  });

  it("returns an empty mask when there is no foreground", () => {
    const empty = largestComponent(new Uint8Array(16), 4, 4);
    expect(empty.every((v) => v === 0)).toBe(true);
  });

  it("survives a body large enough to overflow a recursive fill", () => {
    /* 300 x 300 solid: a recursive flood fill blows the stack here. */
    const size = 300;
    const mask = new Uint8Array(size * size).fill(1);
    expect(largestComponent(mask, size, size).reduce((sum, v) => sum + v, 0)).toBe(size * size);
  });
});

describe("fillHoles", () => {
  it("closes a pocket enclosed by the body, such as a printed shirt", () => {
    const width = 10;
    const height = 10;
    const mask = new Uint8Array(width * height);
    for (let y = 2; y <= 7; y += 1) for (let x = 2; x <= 7; x += 1) mask[y * width + x] = 1;
    mask[4 * width + 4] = 0;
    mask[4 * width + 5] = 0;

    const filled = fillHoles(mask, width, height);
    expect(filled[4 * width + 4]).toBe(1);
    expect(filled[4 * width + 5]).toBe(1);
    /* The outside is still outside. */
    expect(filled[0]).toBe(0);
  });

  it("leaves a concave notch open, because it is not enclosed", () => {
    const width = 10;
    const height = 10;
    const mask = new Uint8Array(width * height);
    for (let y = 2; y <= 7; y += 1) for (let x = 2; x <= 7; x += 1) mask[y * width + x] = 1;
    /* A bite out of the right edge: reachable from outside, so not a hole. */
    for (let y = 4; y <= 5; y += 1) for (let x = 6; x <= 7; x += 1) mask[y * width + x] = 0;

    expect(fillHoles(mask, width, height)[4 * width + 7]).toBe(0);
  });
});

describe("silhouetteFrom", () => {
  it("finds a body standing against a plain wall", () => {
    const image = canvas(80, 200, WALL);
    paint(image, 30, 20, 50, 180, BODY);

    const extent = bodyExtent(rowSpans(silhouetteFrom(image)));
    expect(extent).not.toBeNull();
    expect(extent!.top).toBe(20);
    expect(extent!.bottom).toBe(180);
  });

  it("ignores a shadow smaller than the body", () => {
    const image = canvas(80, 200, WALL);
    paint(image, 30, 20, 50, 180, BODY);
    paint(image, 2, 150, 8, 170, [200, 198, 196]);

    const silhouette = silhouetteFrom(image);
    expect(silhouette.mask[160 * 80 + 5]).toBe(0);
    expect(silhouette.mask[100 * 80 + 40]).toBe(1);
  });

  it("produces an empty mask for an empty wall", () => {
    const silhouette = silhouetteFrom(canvas(40, 40, WALL));
    expect(bodyExtent(rowSpans(silhouette))).toBeNull();
  });

  it("cannot separate a body from a wall of the same colour", () => {
    /* The documented failure mode. It must fail to a mask a quality check can
       reject, not to a plausible-looking wrong answer. */
    const image = canvas(80, 200, WALL);
    paint(image, 30, 20, 50, 180, [225, 223, 220]);
    expect(bodyExtent(rowSpans(silhouetteFrom(image)))).toBeNull();
  });
});
