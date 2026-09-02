import { prisma } from "@/lib/db";
import type { BodyMeasurement, BodyProfile, RecordedSource } from "@/lib/body-metrics";
import { DEFAULT_APPEARANCE, type BodyAppearance } from "@/lib/body-visualization";

/**
 * Reading side of body progress. Weight is joined from the weight log rather
 * than stored on a measurement, so the weight chart, the goal line and body
 * progress can never disagree about what someone weighed on a given day.
 */

const num = (value: { toString(): string } | null) => (value === null ? null : Number(value.toString()));

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

/** Whole years at today's date, or null without a birth date. */
export function ageInYears(birthDate: Date | null, now = new Date()): number | null {
  if (!birthDate) return null;
  const years = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  return beforeBirthday ? years - 1 : years;
}

export interface BodyProgressData {
  measurements: BodyMeasurement[];
  profile: BodyProfile;
  appearance: BodyAppearance;
  /** Whether the reader has ever chosen a figure, as opposed to getting the default. */
  appearanceChosen: boolean;
}

/**
 * Every session a user has recorded, oldest first, each carrying that day's
 * weight. A day with a weight but no tape measurements is still a session: the
 * weight is a body measurement like any other.
 */
export async function loadBodyProgress(userId: string): Promise<BodyProgressData> {
  const [rows, weights, profile] = await Promise.all([
    prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { date: "asc" }, take: 400 }),
    prisma.weightEntry.findMany({ where: { userId }, orderBy: { date: "asc" }, take: 400 }),
    prisma.userProfile.findUnique({
      where: { userId },
      select: { heightCm: true, birthDate: true, biologicalSex: true, bodyType: true, bodyFigure: true },
    }),
  ]);

  const weightByDate = new Map(weights.map((entry) => [dateKey(entry.date), Number(entry.weightKg)]));
  const byDate = new Map<string, BodyMeasurement>();

  for (const row of rows) {
    const date = dateKey(row.date);
    byDate.set(date, {
      date,
      weightKg: weightByDate.get(date) ?? null,
      neckCm: num(row.neckCm),
      chestCm: num(row.chestCm),
      waistCm: num(row.waistCm),
      hipCm: num(row.hipCm),
      upperArmLeftCm: num(row.upperArmLeftCm),
      upperArmRightCm: num(row.upperArmRightCm),
      thighLeftCm: num(row.thighLeftCm),
      thighRightCm: num(row.thighRightCm),
      calfLeftCm: num(row.calfLeftCm),
      calfRightCm: num(row.calfRightCm),
      bodyFatPct: num(row.bodyFatPct),
      muscleKg: num(row.muscleKg),
      bodyWaterPct: num(row.bodyWaterPct),
      boneKg: num(row.boneKg),
      compositionSource: (row.compositionSource as RecordedSource | null) ?? null,
    });
  }

  /* A weigh-in on a day with no tape session still belongs on the timeline. */
  for (const [date, weightKg] of weightByDate) {
    if (byDate.has(date)) continue;
    byDate.set(date, {
      date,
      weightKg,
      neckCm: null,
      chestCm: null,
      waistCm: null,
      hipCm: null,
      upperArmLeftCm: null,
      upperArmRightCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfLeftCm: null,
      calfRightCm: null,
      bodyFatPct: null,
      muscleKg: null,
      bodyWaterPct: null,
      boneKg: null,
      compositionSource: null,
    });
  }

  const measurements = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const sex = profile?.biologicalSex;

  return {
    measurements,
    profile: {
      heightCm: profile?.heightCm ? Number(profile.heightCm) : 0,
      sex: sex === "MALE" ? "male" : sex === "FEMALE" ? "female" : null,
      ageYears: ageInYears(profile?.birthDate ?? null),
    },
    appearance: {
      type: profile?.bodyType ?? DEFAULT_APPEARANCE.type,
      figure: profile?.bodyFigure ?? DEFAULT_APPEARANCE.figure,
    },
    appearanceChosen: profile?.bodyType != null && profile?.bodyFigure != null,
  };
}
