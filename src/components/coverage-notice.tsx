import { getTranslations } from "next-intl/server";
import { formatPercent } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

/**
 * Says how much of the day's food actually carried data for a nutrient, so a
 * gap in the data is never mistaken for a zero intake.
 */
export async function CoverageNotice({
  nutrientKey,
  coverage,
  locale,
}: {
  nutrientKey: string;
  coverage: number | null;
  locale: Locale;
}) {
  const t = await getTranslations("today");
  const nutrients = await getTranslations("nutrients");
  if (coverage === null) return null;

  return (
    <div className={`notice${coverage < 0.75 ? " notice-warn" : ""}`} style={{ marginTop: 14 }}>
      <span className="notice-icon" aria-hidden="true">
        ⓘ
      </span>
      <span>
        {t("coverage", {
          nutrient: nutrients(nutrientKey as "vitaminC"),
          percent: formatPercent(coverage, locale),
        })}
        <br />
        <span className="muted">{t("coverageHint")}</span>
      </span>
    </div>
  );
}
