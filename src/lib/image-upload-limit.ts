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
  imageUploadMaxMb(value) * MAX_IMAGES_PER_REQUEST + 1;

/**
 * Shared file-size policy for every image upload.
 *
 * The value is deliberately an integer number of MiB: it keeps UI text, file
 * validation, and Next's request-body ceiling based on the same setting.
 */
export function imageUploadMaxMb(value = process.env.IMAGE_UPLOAD_MAX_MB): number {
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
