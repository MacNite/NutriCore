"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "./session";
import { normalizeName } from "@/lib/units";
import { EDITABLE_KEYS } from "@/lib/nutrients";
import type { FormState } from "./profile-actions";
import { validateReferenceUrl } from "./research";

const optionalNumber = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value.replace(",", "."))))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0), { message: "invalid" });

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).optional(),
  barcode: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || /^\d{8,14}$/.test(value), { message: "invalid-barcode" }),
  basisUnit: z.enum(["G", "ML"]),
  basisAmount: z.coerce.number().positive().max(10_000),
  servingSize: optionalNumber,
  servingUnit: z.string().trim().max(40).optional(),
  densityGPerMl: optionalNumber,
  sourceUrl: z.string().trim().max(2000).optional(),
});

export async function createFoodAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  const parsed = schema.safeParse({
    name: formData.get("name"),
    brand: formData.get("brand") ?? "",
    barcode: formData.get("barcode") ?? "",
    basisUnit: formData.get("basisUnit"),
    basisAmount: formData.get("basisAmount"),
    servingSize: formData.get("servingSize") ?? "",
    servingUnit: formData.get("servingUnit") ?? "",
    densityGPerMl: formData.get("densityGPerMl") ?? "",
    sourceUrl: formData.get("sourceUrl") ?? "",
  });
  if (!parsed.success) return { error: "validation" };
  const sourceUrl = validateReferenceUrl(parsed.data.sourceUrl ?? "");
  if (parsed.data.sourceUrl && !sourceUrl) return { error: "validation" };

  // An empty field means "unknown" and is simply not stored - it never becomes
  // a zero value.
  const nutrients = EDITABLE_KEYS.flatMap((key) => {
    const raw = String(formData.get(`n_${key}`) ?? "").trim();
    if (raw === "") return [];
    const value = Number(raw.replace(",", "."));
    return Number.isFinite(value) && value >= 0 ? [{ nutrientKey: key, value }] : [];
  });

  const data = parsed.data;
  const food = await prisma.food.create({
    data: {
      ownerId: user.id,
      name: data.name,
      normalizedName: normalizeName(data.name),
      brand: data.brand || null,
      barcode: data.barcode,
      locale: user.language,
      foodType: "GENERIC",
      sourceType: "USER",
      basisAmount: data.basisAmount,
      basisUnit: data.basisUnit,
      servingSize: data.servingSize,
      servingUnit: data.servingUnit || null,
      densityGPerMl: data.densityGPerMl,
      isEstimated: false,
      nutrients: { createMany: { data: nutrients } },
      sources: {
        create: {
          provider: "USER",
          retrievedAt: new Date(),
          estimated: false,
          url: sourceUrl,
        },
      },
    },
  });

  revalidatePath("/foods");
  const meal = String(formData.get("meal") ?? "SNACKS");
  const date = String(formData.get("date") ?? "");
  redirect(`/foods/${food.id}?meal=${meal}${date ? `&date=${date}` : ""}`);
}
