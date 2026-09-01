"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "./session";
import { recalculateTarget } from "./targets";
import { LOCALES } from "@/i18n/locales";
import { logger } from "@/lib/logger";

export interface FormState {
  ok?: boolean;
  error?: string;
}

const optionalNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : Number(value.replace(",", "."))))
    .refine((value) => value === null || (Number.isFinite(value) && value >= min && value <= max), {
      message: "out-of-range",
    });

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  language: z.enum(LOCALES),
  birthDate: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), { message: "invalid-date" }),
  heightCm: optionalNumber(50, 260),
  weightKg: optionalNumber(20, 400),
  targetWeightKg: optionalNumber(20, 400),
  biologicalSex: z.enum(["MALE", "FEMALE", "UNSPECIFIED"]),
  activityLevel: z.enum(["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE", "VERY_ACTIVE"]),
  goal: z.enum(["LOSE", "MAINTAIN", "GAIN", "CUSTOM"]),
  isPregnant: z.boolean(),
  isBreastfeeding: z.boolean(),
});

const asBool = (value: FormDataEntryValue | null) => value === "on" || value === "true";

export async function saveProfileAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
    language: formData.get("language"),
    birthDate: formData.get("birthDate") ?? "",
    heightCm: formData.get("heightCm") ?? "",
    weightKg: formData.get("weightKg") ?? "",
    targetWeightKg: formData.get("targetWeightKg") ?? "",
    biologicalSex: formData.get("biologicalSex"),
    activityLevel: formData.get("activityLevel"),
    goal: formData.get("goal"),
    isPregnant: asBool(formData.get("isPregnant")),
    isBreastfeeding: asBool(formData.get("isBreastfeeding")),
  });

  if (!parsed.success) return { error: "validation" };
  const data = parsed.data;

  await prisma.userProfile.update({
    where: { userId: user.id },
    data: {
      displayName: data.displayName,
      language: data.language,
      birthDate: data.birthDate ? new Date(`${data.birthDate}T00:00:00.000Z`) : null,
      heightCm: data.heightCm,
      weightKg: data.weightKg,
      targetWeightKg: data.targetWeightKg,
      biologicalSex: data.biologicalSex,
      activityLevel: data.activityLevel,
      goal: data.goal,
      isPregnant: data.isPregnant,
      isBreastfeeding: data.isBreastfeeding,
      onboardedAt: new Date(),
    },
  });

  // Weight entered in the profile doubles as today's weight entry.
  if (data.weightKg !== null) {
    const today = new Date();
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    await prisma.weightEntry.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: { userId: user.id, date, weightKg: data.weightKg },
      update: { weightKg: data.weightKg },
    });
  }

  await recalculateTarget(user.id);
  (await cookies()).set("NEXT_LOCALE", data.language, { path: "/", maxAge: 31_536_000, sameSite: "lax" });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function completeOnboardingAction(state: FormState, formData: FormData): Promise<FormState> {
  const result = await saveProfileAction(state, formData);
  if (result.error) return result;
  redirect("/");
}

const overrideSchema = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value.replace(",", "."))))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 800 && value <= 8000), {
    message: "out-of-range",
  });

/** A user may always override the calculated target. */
export async function saveTargetOverrideAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = overrideSchema.safeParse(formData.get("overrideKcal") ?? "");
  if (!parsed.success) return { error: "validation" };

  const latest = await prisma.nutritionTarget.findFirst({ where: { userId: user.id }, orderBy: { validFrom: "desc" } });
  if (latest) await prisma.nutritionTarget.update({ where: { id: latest.id }, data: { overrideKcal: parsed.data } });
  else await prisma.nutritionTarget.create({ data: { userId: user.id, overrideKcal: parsed.data } });

  await recalculateTarget(user.id);
  revalidatePath("/");
  revalidatePath("/settings");
  return { ok: true };
}

const settingsSchema = z.object({
  language: z.enum(LOCALES),
  aiEnabled: z.boolean(),
  researchEnabled: z.boolean(),
  autoApproveAi: z.boolean(),
});

export async function saveSettingsAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = settingsSchema.safeParse({
    language: formData.get("language"),
    aiEnabled: asBool(formData.get("aiEnabled")),
    researchEnabled: asBool(formData.get("researchEnabled")),
    autoApproveAi: asBool(formData.get("autoApproveAi")),
  });
  if (!parsed.success) return { error: "validation" };

  await prisma.userProfile.update({
    where: { userId: user.id },
    data: parsed.data,
  });

  (await cookies()).set("NEXT_LOCALE", parsed.data.language, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteAccountAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  // Typing the username is the confirmation; a stray click cannot delete data.
  if (formData.get("confirm") !== user.username) return { error: "validation" };

  // Cascades remove the profile, diary, foods, weights and sessions.
  await prisma.user.delete({ where: { id: user.id } });
  logger.info("Account deleted", { userId: user.id });

  (await cookies()).delete("nutricore_session");
  redirect("/login");
}
