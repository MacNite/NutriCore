import { getTranslations } from "next-intl/server";
import { weightStats, type WeightPoint } from "@/lib/weight";
import { formatDate, formatNumber } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

/**
 * One sentence describing the plotted range. The chart uses it as its
 * accessible label, the weight log repeats it above the table.
 */
export async function weightSummary(points: WeightPoint[], locale: Locale): Promise<string | null> {
  const stats = weightStats(points);
  if (!stats) return null;

  const t = await getTranslations("progress");
  return t("chartSummary", {
    from: formatDate(stats.first.date, locale),
    to: formatDate(stats.last.date, locale),
    count: points.length,
    min: formatNumber(stats.min, locale),
    max: formatNumber(stats.max, locale),
  });
}
