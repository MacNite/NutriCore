import type { Silhouette } from "./body-scan";

/**
 * Turning a photograph into a foreground mask, without a segmentation model.
 *
 * The assumption this makes is stated plainly to the user rather than hidden:
 * stand against a plain wall. Given that, the background is the few thousand
 * pixels around the edge of the frame, a pixel far enough from that colour is
 * the person, and the largest connected blob of those is the person rather than
 * a shadow or a doorframe.
 *
 * It is the weakest link in the pipeline and it is meant to be replaceable: a
 * segmentation model that produces the same `Silhouette` drops in here without
 * anything downstream noticing. Everything after this point is geometry that
 * does not care where the mask came from.
 *
 * Pure, and free of `sharp`, so it can be tested on pixel arrays directly.
 */

/** Decoded image pixels: three bytes per pixel, row-major. */
export interface RgbImage {
  width: number;
  height: number;
  /** Length must be `width * height * 3`. */
  data: Uint8Array;
}

/**
 * How far from the background colour a pixel must be to count as foreground,
 * as a Euclidean distance in RGB.
 *
 * Low enough that a dark grey shirt against a white wall is caught, high enough
 * that camera noise and uneven wall lighting are not. Skin against a similarly
 * toned wall will defeat it, which `assessCapture` then rejects as a merged
 * silhouette rather than measuring nonsense.
 */
const FOREGROUND_DISTANCE = 60;

/** How deep a border ring to sample the background from, as a fraction of the frame. */
const BORDER_FRACTION = 0.04;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The background colour, as the median of a ring of border pixels.
 *
 * A median rather than a mean: a person who overlaps the frame edge, or a
 * skirting board along the bottom, shifts a mean and leaves a median alone.
 */
export function backgroundColour(image: RgbImage): Rgb {
  const border = Math.max(1, Math.round(Math.min(image.width, image.height) * BORDER_FRACTION));
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  const sample = (x: number, y: number) => {
    const i = (y * image.width + x) * 3;
    reds.push(image.data[i]);
    greens.push(image.data[i + 1]);
    blues.push(image.data[i + 2]);
  };

  for (let y = 0; y < image.height; y += 1) {
    const vertical = y < border || y >= image.height - border;
    for (let x = 0; x < image.width; x += 1) {
      if (vertical || x < border || x >= image.width - border) sample(x, y);
    }
  }

  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return { r: median(reds), g: median(greens), b: median(blues) };
}

/** Squared distance, so the threshold comparison needs no square root per pixel. */
const distanceSq = (image: RgbImage, index: number, background: Rgb) => {
  const i = index * 3;
  const dr = image.data[i] - background.r;
  const dg = image.data[i + 1] - background.g;
  const db = image.data[i + 2] - background.b;
  return dr * dr + dg * dg + db * db;
};

/**
 * The largest connected foreground region, which is the person.
 *
 * Iterative flood fill rather than recursion: a body in a tall photograph is
 * hundreds of thousands of connected pixels and a recursive fill overflows the
 * stack on exactly the input that matters.
 */
export function largestComponent(mask: Uint8Array, width: number, height: number): Uint8Array {
  const labels = new Int32Array(mask.length).fill(-1);
  const stack: number[] = [];
  let best = -1;
  let bestSize = 0;
  let label = 0;

  const visit = (next: number, current: number) => {
    if (mask[next] && labels[next] === -1) {
      labels[next] = current;
      stack.push(next);
    }
  };

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start] !== -1) continue;
    let size = 0;
    labels[start] = label;
    stack.push(start);

    while (stack.length) {
      const index = stack.pop()!;
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      /* Four-connected: a diagonal touch is not a limb, it is noise. */
      if (x > 0) visit(index - 1, label);
      if (x < width - 1) visit(index + 1, label);
      if (y > 0) visit(index - width, label);
      if (y < height - 1) visit(index + width, label);
    }

    if (size > bestSize) {
      bestSize = size;
      best = label;
    }
    label += 1;
  }

  const out = new Uint8Array(mask.length);
  if (best === -1) return out;
  for (let i = 0; i < mask.length; i += 1) if (labels[i] === best) out[i] = 1;
  return out;
}

/**
 * Fills background pockets enclosed by the body.
 *
 * A printed shirt or a bright highlight reads as background and punches a hole
 * in the torso, which `filled` pixel counts then under-report. Anything not
 * reachable from the frame edge is inside the body, so flooding the outside and
 * inverting is both simpler and more robust than hole detection.
 */
export function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];

  const push = (index: number) => {
    if (!mask[index] && !outside[index]) {
      outside[index] = 1;
      stack.push(index);
    }
  };

  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (stack.length) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) out[i] = outside[i] ? 0 : 1;
  return out;
}

/**
 * A silhouette from a photograph taken against a plain background.
 *
 * The three steps are separable and separately tested: threshold against the
 * background colour, keep the largest blob, close the holes in it.
 */
export function silhouetteFrom(image: RgbImage, threshold = FOREGROUND_DISTANCE): Silhouette {
  const background = backgroundColour(image);
  const limit = threshold * threshold;
  const raw = new Uint8Array(image.width * image.height);
  for (let i = 0; i < raw.length; i += 1) {
    if (distanceSq(image, i, background) > limit) raw[i] = 1;
  }
  const body = largestComponent(raw, image.width, image.height);
  return { width: image.width, height: image.height, mask: fillHoles(body, image.width, image.height) };
}
