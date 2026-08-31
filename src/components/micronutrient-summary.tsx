import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/locales";
import { formatNutrient, formatPercent } from "@/lib/format";
import { NUTRIENTS } from "@/lib/nutrients";

const MICRONUTRIENTS = NUTRIENTS.filter(
  (nutrient) => nutrient.category === "mineral" || nutrient.category === "vitamin",
);

export async function MicronutrientSummary({
  totals,
  knownTotals,
  coverage,
  locale,
  compact = false,
}: {
  totals: Record<string, number | null>;
  knownTotals: Record<string, number | null>;
  coverage: Record<string, number | null>;
  locale: Locale;
  compact?: boolean;
}) {
  const t = await getTranslations("micronutrients");
  const nutrientT = await getTranslations("nutrients");
  const common = await getTranslations("common");
  const visible = compact ? MICRONUTRIENTS.filter((nutrient) =>
    ["calcium", "iron", "magnesium", "potassium", "vitaminC", "vitaminD"].includes(nutrient.key),
  ) : MICRONUTRIENTS;

  return (
    <div className="micro-summary">
      <div className="micro-grid">
        {visible.map((nutrient) => {
          const completeValue = totals[nutrient.key] ?? null;
          const value = completeValue ?? knownTotals[nutrient.key] ?? null;
          const nutrientCoverage = coverage[nutrient.key] ?? null;
          const partial = value !== null && completeValue === null && nutrientCoverage !== null;
          const coveragePercent = nutrientCoverage === null
            ? null
            : Math.min(100, Math.max(0, nutrientCoverage * 100));
          const coverageLabel = nutrientCoverage === null
            ? null
            : t("coverage", { percent: formatPercent(nutrientCoverage, locale) });

          return (
            <div className="micro-item" key={nutrient.key}>
              <span>{nutrientT(nutrient.key as "calcium")}</span>
              <strong>
                {value === null ? (
                  <><span aria-hidden="true">–</span><span className="sr-only">{common("unknown")}</span></>
                ) : (
                  <>{formatNutrient(value, locale)} <small>{nutrient.unit}</small></>
                )}
              </strong>
              {coveragePercent !== null ? (
                <progress
                  className="micro-indicator"
                  value={coveragePercent}
                  max="100"
                  aria-label={coverageLabel ?? undefined}
                />
              ) : null}
              {partial ? <small className="micro-coverage">{coverageLabel}</small> : null}
            </div>
          );
        })}
      </div>
      <p className="micro-hint">{t("hint")}</p>
    </div>
  );
}
