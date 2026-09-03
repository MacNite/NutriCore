"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DEFAULT_SHAPE_STYLE } from "@/lib/body-visualization";
import { requireUser } from "./session";
import type { FormState } from "./profile-actions";

/**
 * Writing side of body progress.
 *
 * Weight goes to the weight log, never onto the measurement, so one day has one
 * weight whichever screen recorded it. Everything else is optional: a session
 * where only the waist was measured is a real session.
 */

const optionalNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : Number(value.replace(",", "."))))
    .refine((value) => value === null || (Number.isFinite(value) && value >= min && value <= max), {
      message: "out-of-range",
    });

const CIRCUMFERENCE_KEYS = [
  "neckCm",
  "chestCm",
  "waistCm",
  "hipCm",
  "upperArmLeftCm",
  "upperArmRightCm",
  "thighLeftCm",
  "thighRightCm",
  "calfLeftCm",
  "calfRightCm",
] as const;

const COMPOSITION_KEYS = ["bodyFatPct", "muscleKg", "bodyWaterPct", "boneKg"] as const;

const checkinSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "invalid-date" }),
  weightKg: optionalNumber(20, 400),
  neckCm: optionalNumber(15, 100),
  chestCm: optionalNumber(40, 250),
  waistCm: optionalNumber(30, 250),
  hipCm: optionalNumber(40, 250),
  upperArmLeftCm: optionalNumber(10, 100),
  upperArmRightCm: optionalNumber(10, 100),
  thighLeftCm: optionalNumber(20, 150),
  thighRightCm: optionalNumber(20, 150),
  calfLeftCm: optionalNumber(15, 100),
  calfRightCm: optionalNumber(15, 100),
  bodyFatPct: optionalNumber(1, 80),
  muscleKg: optionalNumber(1, 150),
  bodyWaterPct: optionalNumber(20, 90),
  boneKg: optionalNumber(0.5, 20),
  compositionSource: z.enum(["MANUAL", "BIA", "OTHER_DEVICE"]),
  note: z.string().trim().max(500),
});

/** A date in the future is a typo, not a measurement. */
const isFuture = (date: string) => date > new Date().toISOString().slice(0, 10);

export async function saveBodyCheckinAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const read = (key: string) => formData.get(key) ?? "";

  const parsed = checkinSchema.safeParse({
    date: formData.get("date") ?? "",
    weightKg: read("weightKg"),
    ...Object.fromEntries(CIRCUMFERENCE_KEYS.map((key) => [key, read(key)])),
    ...Object.fromEntries(COMPOSITION_KEYS.map((key) => [key, read(key)])),
    compositionSource: formData.get("compositionSource") ?? "MANUAL",
    note: read("note"),
  });
  if (!parsed.success || isFuture(parsed.data.date)) return { error: "validation" };

  const { date: dateKey, weightKg, compositionSource, note, ...values } = parsed.data;
  const date = new Date(`${dateKey}T00:00:00.000Z`);

  const measured = Object.fromEntries(
    [...CIRCUMFERENCE_KEYS, ...COMPOSITION_KEYS].map((key) => [key, values[key]]),
  ) as Record<(typeof CIRCUMFERENCE_KEYS)[number] | (typeof COMPOSITION_KEYS)[number], number | null>;
  const hasComposition = COMPOSITION_KEYS.some((key) => measured[key] !== null);
  const hasMeasurement = hasComposition || CIRCUMFERENCE_KEYS.some((key) => measured[key] !== null);

  if (weightKg === null && !hasMeasurement) return { error: "empty" };

  await prisma.$transaction(async (tx) => {
    if (weightKg !== null) {
      await tx.weightEntry.upsert({
        where: { userId_date: { userId: user.id, date } },
        create: { userId: user.id, date, weightKg },
        update: { weightKg },
      });
    }

    if (!hasMeasurement) {
      /* Clearing every tape value on an existing session removes it rather than
         leaving a row that records nothing. */
      await tx.bodyMeasurement.deleteMany({ where: { userId: user.id, date } });
      return;
    }

    const data = {
      ...measured,
      /* The source describes the composition values, so it is only meaningful
         when some were entered. */
      compositionSource: hasComposition ? compositionSource : null,
      note: note || null,
    };
    await tx.bodyMeasurement.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: { userId: user.id, date, ...data },
      update: data,
    });
  });

  revalidatePath("/progress");
  return { ok: true };
}

export async function deleteBodyMeasurementAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const dateKey = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;

  await prisma.bodyMeasurement.deleteMany({
    where: { userId: user.id, date: new Date(`${dateKey}T00:00:00.000Z`) },
  });
  revalidatePath("/progress");
}

const appearanceSchema = z.object({
  bodyType: z.enum(["ECTOMORPH", "MESOMORPH", "ENDOMORPH"]),
  bodyFigure: z.enum(["NEUTRAL", "MASCULINE", "FEMININE"]),
  bodyShapeStyle: z.enum(["SILHOUETTE", "MEASURE"]),
});

/**
 * The figure is a look the reader picks for themselves: how it is presented,
 * what build it starts from, and which of the two drawings the shape panel
 * uses. None of it is inferred from their measurements, and none of it enters
 * a calculation.
 */
export async function saveBodyAppearanceAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = appearanceSchema.safeParse({
    bodyType: formData.get("bodyType"),
    bodyFigure: formData.get("bodyFigure"),
    /* An older form that never carried the field still saves a valid figure. */
    bodyShapeStyle: formData.get("bodyShapeStyle") ?? DEFAULT_SHAPE_STYLE,
  });
  if (!parsed.success) return { error: "validation" };

  await prisma.userProfile.update({ where: { userId: user.id }, data: parsed.data });
  revalidatePath("/progress");
  return { ok: true };
}
