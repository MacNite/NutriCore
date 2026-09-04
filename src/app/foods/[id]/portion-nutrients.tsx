"use client";

import { useTranslations } from "next-intl";
import { NutrientTable } from "@/components/nutrient-table";
import { formatNumber } from "@/lib/format";
import type { Nutrients } from "@/lib/nutrition";
import type { Locale } from "@/i18n/locales";
import { parseQuantity, usePortion } from "./portion-context";
import { portionPreview, type FoodShape } from "./portion";

/**
 * The nutrient table plus a column for the portion currently entered in the
 * log form: the values that will actually land in the diary, not just the
 * food's own basis.
 */
export function PortionNutrients({
  food,
  nutrients,
  basisAmount,
  locale,
}: {
  food: FoodShape;
  nutrients: Nutrients;
  basisAmount: number;
  locale: Locale;
}) {
  const t = useTranslations("foods");
  const { quantity, unit } = usePortion();

  const amount = parseQuantity(quantity);
  const preview = portionPreview(amount, unit, food, nutrients, basisAmount);
  const entered = Number.isFinite(amount) ? formatNumber(amount, locale, 2) : quantity.trim();

  return (
    <NutrientTable
      nutrients={nutrients}
      basisAmount={basisAmount}
      basisUnit={food.basisUnit}
      locale={locale}
      column={{
        label: entered ? t("forPortion", { amount: entered, unit }) : t("forPortionUnknown"),
        hint:
          preview.amount != null && preview.converted
            ? t("portionEquivalent", {
                amount: formatNumber(preview.amount, locale, 1),
                unit: preview.basisUnit === "ML" ? "ml" : "g",
              })
            : null,
        nutrients: preview.nutrients,
      }}
    />
  );
}
