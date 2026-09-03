import { prisma } from "@/lib/db";
import { imageUploadMaxBytes } from "@/lib/image-upload-limit";
import { IMAGE_UPLOAD_TYPES, validateImageUpload, type ImageUploadError } from "./image-upload";

export const MEAL_IMAGE_MAX_BYTES = imageUploadMaxBytes();

/**
 * How long an uploaded photo may sit in the database waiting for a worker.
 *
 * Deliberately short. The bytes live on the row because this deployment has no
 * object storage, which means a `pg_dump` taken while one is present contains
 * it - so the window a backup can catch is the window that matters, not the
 * convenience of a generous timeout. Fifteen minutes is far longer than the
 * queue ever takes and short enough that the exposure is nearly always nil.
 * A job that outlives it has already failed for other reasons.
 */
export const MEAL_IMAGE_TTL_MS = 15 * 60 * 1000;
export const MEAL_IMAGE_TYPES = IMAGE_UPLOAD_TYPES;

export type MealImageError = ImageUploadError;
export type ValidMealImage = { mime: (typeof MEAL_IMAGE_TYPES)[number]; data: Buffer; expiresAt: Date };

export const hasMealInput = (text: string, sourceUrl: string, image: ValidMealImage | null) =>
  Boolean(text.trim() || sourceUrl.trim() || image);

/** Validates bytes, not the attacker-controlled filename or browser MIME alone. */
export async function validateMealImage(value: FormDataEntryValue | null): Promise<ValidMealImage | null> {
  const image = await validateImageUpload(value, MEAL_IMAGE_MAX_BYTES);
  return image && { ...image, expiresAt: new Date(Date.now() + MEAL_IMAGE_TTL_MS) };
}

/** Central terminal/success cleanup. Keeping this idempotent makes every caller safe. */
export async function discardMealInputImage(inputId: string) {
  return discardMealInputImages([inputId]);
}

export async function discardMealInputImages(inputIds: string[]) {
  if (!inputIds.length) return;
  await prisma.mealInput.updateMany({
    where: { id: { in: inputIds } },
    data: { imageData: null, imageMime: null, imageExpiresAt: null },
  });
}

/** Worker maintenance for uploads abandoned without a runnable job. */
export async function cleanupExpiredMealImages(now = new Date()) {
  const result = await prisma.mealInput.updateMany({
    where: { imageData: { not: null }, imageExpiresAt: { lte: now } },
    data: { imageData: null, imageMime: null, imageExpiresAt: null },
  });
  return result.count;
}
