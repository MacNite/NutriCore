import { imageUploadMaxBytes } from "@/lib/image-upload-limit";

/**
 * One image-upload validator for every feature that takes a photograph.
 *
 * Split out of `meal-image.ts` when body scans became a second uploader: the
 * rules that matter here - decide the type from the bytes, never the filename
 * or the browser's claim about it - are the kind that must not exist twice and
 * drift apart.
 */

export const IMAGE_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type UploadedImageMime = (typeof IMAGE_UPLOAD_TYPES)[number];

export type ImageUploadError = "imageInvalid" | "imageTooLarge" | "imageEmpty";

export interface ValidImageUpload {
  mime: UploadedImageMime;
  data: Buffer;
}

// A browser submits an unselected file input as a zero-byte part carrying no
// filename, and the name that survives decoding depends on the transport: React's
// busboy decoding of a server action turns the missing filename into the literal
// string "undefined", a plain multipart POST keeps "", and appending a nameless
// Blob yields "blob". None of them is a file a user picked.
const UNSELECTED_FILE_NAMES = new Set(["", "undefined", "blob"]);

/** The type the bytes actually are, from their magic number. */
export const detectedMime = (data: Uint8Array): UploadedImageMime | null => {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  return null;
};

/** Validates bytes, not the attacker-controlled filename or browser MIME alone. */
export async function validateImageUpload(
  value: FormDataEntryValue | null,
  maxBytes = imageUploadMaxBytes(),
): Promise<ValidImageUpload | null> {
  if (!(value instanceof File)) return null;
  // Absence, not a user-selected zero-byte image. A genuinely selected empty
  // file still carries its own filename and remains an actionable validation
  // error.
  if (value.size === 0 && UNSELECTED_FILE_NAMES.has(value.name)) return null;
  if (value.size === 0) throw new Error("imageEmpty" satisfies ImageUploadError);
  if (value.size > maxBytes) throw new Error("imageTooLarge" satisfies ImageUploadError);
  if (!IMAGE_UPLOAD_TYPES.includes(value.type as UploadedImageMime)) throw new Error("imageInvalid" satisfies ImageUploadError);
  const data = Buffer.from(await value.arrayBuffer());
  const mime = detectedMime(data);
  if (!mime || mime !== value.type) throw new Error("imageInvalid" satisfies ImageUploadError);
  return { mime, data };
}
