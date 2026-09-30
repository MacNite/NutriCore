export const DEFAULT_IMAGE_UPLOAD_MAX_MB = 5;
/**
 * Lowered from 50. The ceiling is not free: it sets Next's global Server Action
 * body limit (see `next.config.ts`), which applies to *every* action including
 * the unauthenticated sign-in and registration ones, so whatever is allowed
 * here is what a stranger may post repeatedly before any of this code runs.
 *
 * 15 MiB is still well above a phone photograph, and two of them is the largest
 * request the application legitimately makes.
 */
export const MAX_CONFIGURED_IMAGE_UPLOAD_MB = 15;

/** A body scan submits a front and a side capture in one request. */
export const MAX_IMAGES_PER_REQUEST = 2;

/**
 * The largest request body the application has any use for, in MiB.
 *
 * Multipart framing, field names and boundaries are a few hundred bytes against
 * megabytes of image, so one MiB covers them with room to spare.
 */
export const requestBodyLimitMb = (value = process.env.IMAGE_UPLOAD_MAX_MB) =>
  configuredImageUploadMaxMb(value) * MAX_IMAGES_PER_REQUEST + 1;

/**
 * The limit this build's request ceilings were sized for, inlined by
 * `next.config.ts`.
 *
 * The ceilings are fixed when the image is built, but `IMAGE_UPLOAD_MAX_MB` is
 * also read at runtime - and the published image is built with the default. A
 * deployment that raised the limit in its `.env` therefore got a form that
 * posted a 13 MB photograph unshrunk, because it fit the runtime limit, into a
 * request ceiling of 11 MB that truncated it: "Unexpected end of form", and the
 * generic error page. Capping the runtime value at this one keeps the browser's
 * shrink threshold, the per-file validation and the ceilings in agreement.
 *
 * Unset outside a Next build (the config itself, the worker, the tests), where
 * there is no ceiling to stay under.
 */
const builtImageUploadMaxMb = () => process.env.NUTRICORE_BUILT_IMAGE_UPLOAD_MAX_MB;

/** A whole positive number of MiB, or null when the value says nothing usable. */
function parseMb(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Shared file-size policy for every image upload.
 *
 * The value is deliberately an integer number of MiB: it keeps UI text, file
 * validation, and Next's request-body ceiling based on the same setting.
 */
export function imageUploadMaxMb(value = process.env.IMAGE_UPLOAD_MAX_MB, built = builtImageUploadMaxMb()): number {
  const configured = configuredImageUploadMaxMb(value);
  const ceiling = parseMb(built);
  return ceiling === null ? configured : Math.min(configured, ceiling);
}

/** `IMAGE_UPLOAD_MAX_MB` as the policy reads it, before the build caps it. */
export function configuredImageUploadMaxMb(value = process.env.IMAGE_UPLOAD_MAX_MB): number {
  if (value === undefined || value.trim() === "") return DEFAULT_IMAGE_UPLOAD_MAX_MB;
  const parsed = Number(value);
  // Not a whole positive number of MiB: the value says nothing usable, so the
  // default is the only safe reading of it.
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_IMAGE_UPLOAD_MAX_MB;
  // Above the ceiling the intent is clear and only the amount is refused, so it
  // is clamped rather than dropped to the default. Silently giving a deployment
  // that asked for 50 the 5 MiB default is a worse answer than giving it the
  // largest value policy allows.
  return Math.min(parsed, MAX_CONFIGURED_IMAGE_UPLOAD_MB);
}

export const imageUploadMaxBytes = (value = process.env.IMAGE_UPLOAD_MAX_MB) =>
  imageUploadMaxMb(value) * 1024 * 1024;
