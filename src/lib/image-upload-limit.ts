export const DEFAULT_IMAGE_UPLOAD_MAX_MB = 5;
export const MAX_CONFIGURED_IMAGE_UPLOAD_MB = 50;

/**
 * Shared file-size policy for every image upload.
 *
 * The value is deliberately an integer number of MiB: it keeps UI text, file
 * validation, and Next's request-body ceiling based on the same setting.
 */
export function imageUploadMaxMb(value = process.env.IMAGE_UPLOAD_MAX_MB): number {
  if (value === undefined || value.trim() === "") return DEFAULT_IMAGE_UPLOAD_MAX_MB;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_CONFIGURED_IMAGE_UPLOAD_MB
    ? parsed
    : DEFAULT_IMAGE_UPLOAD_MAX_MB;
}

export const imageUploadMaxBytes = (value = process.env.IMAGE_UPLOAD_MAX_MB) =>
  imageUploadMaxMb(value) * 1024 * 1024;
