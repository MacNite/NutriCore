import { prisma } from "@/lib/db";
import { calculateExerciseEnergy } from "@/lib/activity-calories";
import { findActivityVariant } from "@/lib/activities";
import { diaryDate } from "./diary";

export class ActivityInputError extends Error {}
export class ActivityNotFoundError extends Error {}

export async function effectiveWeight(userId: string, date: string): Promise<number | null> {
  const [weight, profile] = await Promise.all([
    prisma.weightEntry.findFirst({ where: { userId, date: { lte: diaryDate(date) } }, orderBy: { date: "desc" } }),
    prisma.userProfile.findUnique({ where: { userId }, select: { weightKg: true } }),
  ]);
  return weight ? Number(weight.weightKg) : profile?.weightKg == null ? null : Number(profile.weightKg);
}

export async function getActivityEntries(userId: string, date: string) {
  const entries = await prisma.activityEntry.findMany({ where: { userId, date: diaryDate(date) }, orderBy: { createdAt: "asc" } });
  return {
    entries: entries.map((entry) => ({ ...entry, metSnapshot: Number(entry.metSnapshot), weightKgSnapshot: entry.weightKgSnapshot == null ? null : Number(entry.weightKgSnapshot), activeKcalSnapshot: entry.activeKcalSnapshot == null ? null : Number(entry.activeKcalSnapshot) })),
    // Exercise remains separate from TDEE: adding it to the allowance would double-count activity.
    totalActiveKcal: entries.reduce<number | null>((total, entry) => entry.activeKcalSnapshot == null ? total : (total ?? 0) + Number(entry.activeKcalSnapshot), null),
  };
}

async function snapshot(userId: string, date: string, activityKey: string, intensityKey: string) {
  const resolved = findActivityVariant(activityKey, intensityKey);
  if (!resolved) throw new ActivityInputError("invalid activity variant");
  const weightKg = await effectiveWeight(userId, date);
  return { met: resolved.variant.met, weightKg };
}

export async function addActivity(input: { userId: string; date: string; activityKey: string; intensityKey: string; durationMinutes: number }) {
  const value = await snapshot(input.userId, input.date, input.activityKey, input.intensityKey);
  const activeKcal = value.weightKg == null ? null : calculateExerciseEnergy(value.met, value.weightKg, input.durationMinutes).activeKcal;
  return prisma.activityEntry.create({ data: { ...input, date: diaryDate(input.date), metSnapshot: value.met, weightKgSnapshot: value.weightKg, activeKcalSnapshot: activeKcal } });
}

async function owned(userId: string, id: string) {
  const entry = await prisma.activityEntry.findFirst({ where: { id, userId } });
  if (!entry) throw new ActivityNotFoundError();
  return entry;
}

export async function updateActivity(input: { userId: string; id: string; date: string; activityKey: string; intensityKey: string; durationMinutes: number }) {
  await owned(input.userId, input.id);
  const value = await snapshot(input.userId, input.date, input.activityKey, input.intensityKey);
  const activeKcal = value.weightKg == null ? null : calculateExerciseEnergy(value.met, value.weightKg, input.durationMinutes).activeKcal;
  return prisma.activityEntry.update({ where: { id: input.id }, data: { date: diaryDate(input.date), activityKey: input.activityKey, intensityKey: input.intensityKey, durationMinutes: input.durationMinutes, metSnapshot: value.met, weightKgSnapshot: value.weightKg, activeKcalSnapshot: activeKcal } });
}

export async function deleteActivity(userId: string, id: string) {
  await owned(userId, id);
  await prisma.activityEntry.delete({ where: { id } });
}
