import { prisma } from "@/lib/db";

export const MEAL_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
export const MEAL_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
export const MEAL_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type MealImageError = "imageInvalid" | "imageTooLarge" | "imageEmpty";
export type ValidMealImage = { mime: (typeof MEAL_IMAGE_TYPES)[number]; data: Buffer; expiresAt: Date };

export const hasMealInput = (text: string, sourceUrl: string, image: ValidMealImage | null) =>
  Boolean(text.trim() || sourceUrl.trim() || image);

const detectedMime = (data: Uint8Array): ValidMealImage["mime"] | null => {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  return null;
};

/** Validates bytes, not the attacker-controlled filename or browser MIME alone. */
export async function validateMealImage(value: FormDataEntryValue | null): Promise<ValidMealImage | null> {
  if (!(value instanceof File)) return null;
  if (value.size === 0) throw new Error("imageEmpty" satisfies MealImageError);
  if (value.size > MEAL_IMAGE_MAX_BYTES) throw new Error("imageTooLarge" satisfies MealImageError);
  if (!MEAL_IMAGE_TYPES.includes(value.type as ValidMealImage["mime"])) throw new Error("imageInvalid" satisfies MealImageError);
  const data = Buffer.from(await value.arrayBuffer());
  const mime = detectedMime(data);
  if (!mime || mime !== value.type) throw new Error("imageInvalid" satisfies MealImageError);
  return { mime, data, expiresAt: new Date(Date.now() + MEAL_IMAGE_TTL_MS) };
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

/** Worker maintenance for uploads abandoned without a runnable job (24-hour TTL). */
export async function cleanupExpiredMealImages(now = new Date()) {
  const result = await prisma.mealInput.updateMany({
    where: { imageData: { not: null }, imageExpiresAt: { lte: now } },
    data: { imageData: null, imageMime: null, imageExpiresAt: null },
  });
  return result.count;
}
