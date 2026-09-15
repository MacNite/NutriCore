/**
 * Brings an oversized photograph under the upload limit, in the browser, before
 * the form posts it.
 *
 * Without this a phone photograph does not merely fail validation - it never
 * reaches validation at all. Next buffers a request body for the middleware
 * under a ceiling derived from `IMAGE_UPLOAD_MAX_MB` (see `next.config.ts`),
 * and that ceiling *truncates* rather than rejects: the multipart parser then
 * dies on the half a form it was handed, the server action never runs, and the
 * reader gets the generic "something went wrong" screen with nothing to act on.
 * A 48-megapixel camera clears that ceiling with one picture, so the feature
 * simply stopped working for anybody photographing a recipe with a recent
 * phone.
 *
 * Shrinking is the honest fix rather than a larger ceiling: whatever the
 * ceiling allows is what an unauthenticated stranger may post at /login, and
 * the photograph is on its way to a vision model that downscales it anyway. A
 * long edge of 2048 px is more than any of them reads.
 *
 * Only a file that is actually too large is touched. One that already fits is
 * posted as it was picked, because re-encoding it would cost quality and buy
 * nothing.
 */

/**
 * Long edge and JPEG quality, tried in order until the result fits.
 *
 * The first step ends it for any photograph a phone takes; the rest exist for
 * the pathological cases - a panorama, a screenshot of a whole recipe page -
 * where detail survives compression far better than the size estimate assumes.
 */
export const SHRINK_STEPS = [
  { maxEdge: 2048, quality: 0.82 },
  { maxEdge: 1600, quality: 0.75 },
  { maxEdge: 1280, quality: 0.68 },
  { maxEdge: 1024, quality: 0.6 },
] as const;

/**
 * The size `maxEdge` implies, keeping the aspect ratio and never enlarging.
 *
 * Enlarging is the case worth stating: a small image that is over the limit is
 * over it because of its encoding, not its dimensions, and scaling it up to
 * meet a step would make the file bigger rather than smaller.
 */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `name` with its extension replaced, since the result is always a JPEG. */
export function jpegName(name: string) {
  const base = name.replace(/\.[^./\\]+$/, "").trim();
  // Never empty: the server reads an empty filename as "no file was picked".
  return `${base || "foto"}.jpg`;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** The older path, for a browser with a canvas but no `createImageBitmap`. */
function decodeAsElement(file: File): Promise<Decoded | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () =>
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * Decoded with its EXIF rotation applied.
 *
 * A phone writes the rotation into the metadata rather than into the pixels, so
 * a canvas that ignores it hands the model a sideways plate. `imageOrientation`
 * is not understood by every browser that has `createImageBitmap`, hence the
 * plain second attempt; an `<img>` is rendered the right way up by every
 * browser current enough to matter, hence the third.
 */
async function decode(file: File): Promise<Decoded | null> {
  const asBitmap = async (options?: ImageBitmapOptions) => {
    const bitmap = await createImageBitmap(file, options);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  };

  if (typeof createImageBitmap === "function") {
    try {
      return await asBitmap({ imageOrientation: "from-image" });
    } catch {
      try {
        return await asBitmap();
      } catch {
        // Falls through to the element path rather than giving up here.
      }
    }
  }
  return decodeAsElement(file);
}

function encode(image: Decoded, width: number, height: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(image.source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * The file to post: the original when it already fits, a smaller JPEG when it
 * does not, and `null` when this browser cannot produce one.
 *
 * `null` is a refusal, not a fallback to the original: posting the original is
 * the failure this exists to prevent.
 */
export async function shrinkImage(file: File, maxBytes: number): Promise<File | null> {
  if (file.size <= maxBytes) return file;

  const image = await decode(file);
  if (!image) return null;
  try {
    for (const step of SHRINK_STEPS) {
      const { width, height } = fitWithin(image.width, image.height, step.maxEdge);
      const blob = await encode(image, width, height, step.quality);
      if (blob && blob.size <= maxBytes) return new File([blob], jpegName(file.name), { type: "image/jpeg" });
    }
  } finally {
    image.release();
  }
  return null;
}
