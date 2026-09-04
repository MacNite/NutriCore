import { prisma } from "@/lib/db";
import type { Nutrients } from "@/lib/nutrition";
import type { EntrySnapshot, ProvenanceSnapshot } from "./diary";

/**
 * Bump when the shape changes so future importers can branch on it.
 *
 * 2 added `bodyMeasurements` and `bodyScans`. Version 1 omitted the body
 * timeline entirely: an export that claimed to be everything personal was
 * silently missing every tape session the user had ever recorded.
 *
 * 3 added `recipePublications`: what the user has shared with the other members
 * of this instance is theirs, and an export that stopped at their private
 * recipes would not say what any of them had been published as.
 */
export const EXPORT_FORMAT_VERSION = 3;

/**
 * Everything personal, in one documented envelope. Password hashes and session
 * tokens are deliberately excluded.
 */
export async function exportUserData(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      profile: true,
      targets: { orderBy: { validFrom: "asc" } },
      weights: { orderBy: { date: "asc" } },
      bodyMeasurements: { orderBy: { date: "asc" } },
      /* Estimates, their review decision and the consent each scan was taken
         under. The captured images are never here: they are deleted minutes
         after a scan runs and an export is not a way to get them back. */
      bodyScans: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, date: true, state: true, heightCm: true, weightKg: true,
          consentVersion: true, provider: true, processorModel: true, version: true,
          accepted: true, qualityReasons: true, failureKind: true,
          createdAt: true, processedAt: true, reviewedAt: true,
          estimates: { orderBy: { metricKey: "asc" } },
        },
      },
      favorites: true,
      usage: true,
      foods: {
        include: {
          nutrients: true,
          servings: true,
          sources: true,
          aliases: true,
        },
      },
      recipes: { include: { ingredients: true } },
      /* What this user has shared, as it currently reads publicly, including a
         publication whose private recipe they have since deleted. */
      publications: { include: { ingredients: { orderBy: { position: "asc" } } }, orderBy: { publishedAt: "asc" } },
      diaryDays: { include: { entries: { orderBy: { createdAt: "asc" } } }, orderBy: { date: "asc" } },
      research: { include: { sources: true, candidates: true } },
    },
  });

  return {
    format: "nutricore.export",
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    user: { id: user.id, email: user.email, username: user.username, createdAt: user.createdAt },
    profile: user.profile,
    targets: user.targets,
    weights: user.weights,
    bodyMeasurements: user.bodyMeasurements,
    bodyScans: user.bodyScans,
    favorites: user.favorites,
    usageStats: user.usage,
    foods: user.foods,
    recipes: user.recipes,
    recipePublications: user.publications,
    diary: user.diaryDays,
    research: user.research,
    notice:
      "Foods sourced from Open Food Facts remain subject to the ODbL. See /about/data-sources.",
  };
}

/** RFC 4180 escaping. A field containing a delimiter, quote or newline is quoted. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const toCsv = (rows: unknown[][]) => rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

const CSV_COLUMNS = ["energyKcal", "protein", "carbohydrate", "fat", "fiber", "sugar", "salt"] as const;

export async function exportDiaryCsv(userId: string) {
  const days = await prisma.diaryDay.findMany({
    where: { userId },
    include: { entries: { orderBy: { createdAt: "asc" } } },
    orderBy: { date: "asc" },
  });

  const rows: unknown[][] = [
    ["date", "meal", "food", "brand", "quantity", "unit", "amount", "amountUnit", "source", "estimated", ...CSV_COLUMNS],
  ];

  for (const day of days) {
    for (const entry of day.entries) {
      const snapshot = entry.nutritionSnapshot as unknown as EntrySnapshot;
      const provenance = entry.provenanceSnapshot as unknown as ProvenanceSnapshot;
      const nutrients: Nutrients = snapshot?.nutrients ?? {};
      rows.push([
        day.date.toISOString().slice(0, 10),
        entry.meal,
        entry.label,
        provenance?.brand ?? "",
        Number(entry.quantity),
        entry.unit,
        entry.normalizedAmount ? Number(entry.normalizedAmount) : "",
        entry.normalizedUnit ?? "",
        provenance?.sourceType ?? "",
        provenance?.isEstimated ? "true" : "false",
        // An unknown nutrient stays an empty cell, never a zero.
        ...CSV_COLUMNS.map((key) => (nutrients[key] == null ? "" : round(nutrients[key]!))),
      ]);
    }
  }

  return toCsv(rows);
}

export async function exportWeightCsv(userId: string) {
  const weights = await prisma.weightEntry.findMany({ where: { userId }, orderBy: { date: "asc" } });
  return toCsv([
    ["date", "weightKg", "note"],
    ...weights.map((w) => [w.date.toISOString().slice(0, 10), Number(w.weightKg), w.note ?? ""]),
  ]);
}

const round = (value: number) => Math.round(value * 1000) / 1000;
