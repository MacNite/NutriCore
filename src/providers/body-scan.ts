import { estimateCircumferences, type ScanQuality, type ScanRegion } from "@/lib/body-scan";
import { silhouetteFrom, type RgbImage } from "@/lib/silhouette";

/**
 * The boundary between "a body scan" and "how this one was computed".
 *
 * Everything the app stores, reviews and exports is described here, so the
 * estimator behind it can be replaced without touching the schema, the review
 * screen or the merge rules. That is the whole point of the interface existing
 * before there is more than one implementation: the geometric estimator shipped
 * today is a floor, not a destination.
 *
 * A future mesh-fitting or learned provider - on a GPU host, in a sidecar
 * container, or from a vendor - satisfies this by returning the same
 * measurements with its own name and version, and may additionally return a
 * `mesh`. Nothing here assumes a mesh exists, and nothing downstream requires
 * one: the progress figure is drawn from circumferences by
 * `body-visualization.ts`, so an avatar never depended on 3D reconstruction.
 */

export interface BodyScanImage {
  mime: string;
  data: Buffer;
}

export interface BodyScanInput {
  front: BodyScanImage;
  side: BodyScanImage;
  /** Declared stature in centimetres: the only thing that establishes scale. */
  heightCm: number;
  /** Closest same-day weight, for provenance. No current provider scales by it. */
  weightKg: number | null;
}

export interface EstimatedValue {
  region: ScanRegion;
  valueCm: number;
  /** An interval the provider stands behind. Never widened or narrowed downstream. */
  lowerCm: number;
  upperCm: number;
}

/**
 * A reconstructed surface, when a provider produces one.
 *
 * Declared but never populated today, and deliberately not persisted by
 * default: a mesh of someone's body is more identifying than the numbers taken
 * from it, and retaining one needs its own consent rather than arriving as a
 * side effect of a provider upgrade.
 */
export interface BodyScanMesh {
  format: "glb" | "obj";
  data: Buffer;
}

export interface BodyScanResult {
  quality: ScanQuality;
  /** Empty whenever quality was rejected. A bad capture yields no numbers. */
  measurements: EstimatedValue[];
  processor: { provider: string; model: string; version: string };
  mesh?: BodyScanMesh;
}

export interface BodyScanProvider {
  readonly name: string;
  estimate(input: BodyScanInput): Promise<BodyScanResult>;
}

/** Raised when an image cannot be decoded at all, as distinct from a poor capture. */
export class BodyScanImageError extends Error {
  constructor(message = "A captured image could not be decoded") {
    super(message);
    this.name = "BodyScanImageError";
  }
}

/**
 * Longest edge the images are worked at.
 *
 * Segmentation and row scanning are linear in pixels, so this is what keeps a
 * scan inside a second on a NAS CPU. It is far more resolution than the
 * estimate can use: a 1024 px stature puts one pixel at under two millimetres,
 * well below the error in the mask itself.
 */
const WORKING_EDGE = 1024;

/**
 * Decodes to raw RGB with `sharp`, which is already a dependency.
 *
 * EXIF rotation is applied and then stripped: a portrait photo whose "up" lives
 * only in metadata would otherwise be measured on its side, and no metadata -
 * orientation, location or otherwise - survives into anything that is stored.
 */
async function decode(image: BodyScanImage): Promise<RgbImage> {
  /* Imported here rather than at module scope so that pulling in the provider
     interface - which the UI does, for its types - never loads a native module
     into the browser bundle. */
  const sharp = (await import("sharp")).default;
  try {
    const { data, info } = await sharp(image.data)
      .rotate()
      .resize({ width: WORKING_EDGE, height: WORKING_EDGE, fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  } catch (error) {
    throw new BodyScanImageError(error instanceof Error ? error.message : undefined);
  }
}

/**
 * The estimator that ships today: two silhouettes, plane geometry, no model.
 *
 * Runs on any CPU in well under a second and needs no weights, no GPU and no
 * network. What it costs is a real constraint on the user - a plain background
 * and close-fitting clothes - and accuracy that has never been validated
 * against a tape measure. Both are stated in the UI rather than implied.
 */
export class SilhouetteBodyScanProvider implements BodyScanProvider {
  readonly name = "silhouette";

  /**
   * Bumped whenever a change moves the numbers.
   *
   * Stored on every scan so a trend can be marked where the method changed: two
   * versions disagreeing is not the body changing, and a chart that cannot tell
   * the difference is worse than no chart.
   */
  static readonly VERSION = "1.0.0";

  async estimate(input: BodyScanInput): Promise<BodyScanResult> {
    const [front, side] = await Promise.all([decode(input.front), decode(input.side)]);
    const result = estimateCircumferences({
      front: silhouetteFrom(front),
      side: silhouetteFrom(side),
      heightCm: input.heightCm,
    });

    return {
      quality: result.quality,
      measurements: result.measurements.map((measurement) => ({
        region: measurement.region,
        valueCm: measurement.valueCm,
        lowerCm: measurement.lowerCm,
        upperCm: measurement.upperCm,
      })),
      processor: {
        provider: this.name,
        model: "two-view-ellipse",
        version: SilhouetteBodyScanProvider.VERSION,
      },
    };
  }
}
