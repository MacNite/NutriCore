import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EnergyRing } from "@/components/energy-ring";
import { MacroBar } from "@/components/macro-bar";
import { formatKcal } from "@/lib/format";
import type { Locale } from "@/i18n/locales";
import type { Nutrients } from "@/lib/nutrition";

export async function DailyEnergySummary({
  consumed,
  totals,
  target,
  locale,
}: {
  consumed: number;
  totals: Nutrients;
  target: { kcal: number | null; proteinG: number | null; carbohydrateG: number | null; fatG: number | null } | null;
  locale: Locale;
}) {
  const t = await getTranslations("today");
  const targetT = await getTranslations("target");
  const common = await getTranslations("common");
  const targetKcal = target?.kcal ?? null;
  const remaining = targetKcal === null ? null : targetKcal - consumed;

  return (
    <div className="energy">
      <EnergyRing
        consumed={consumed}
        target={targetKcal}
        locale={locale}
        summary={t("energyRing")}
        label={targetKcal ? `${common("of")} ${formatKcal(targetKcal, locale)} ${common("kcal")}` : common("kcal")}
      />
      <div>
        <MacroBar label={targetT("protein")} value={totals.protein} target={target?.proteinG ?? null} locale={locale} />
        <MacroBar label={targetT("carbohydrate")} value={totals.carbohydrate} target={target?.carbohydrateG ?? null} locale={locale} variant="carb" />
        <MacroBar label={targetT("fat")} value={totals.fat} target={target?.fatG ?? null} locale={locale} variant="fat" />
        <p className="muted" style={{ margin: "12px 0 0", fontSize: 13.5 }}>
          {remaining === null ? <Link href="/settings">{t("noTarget")}</Link> : (
            <strong style={{ color: "var(--text)" }}>
              {remaining >= 0 ? t("remaining", { amount: formatKcal(remaining, locale) }) : t("over", { amount: formatKcal(Math.abs(remaining), locale) })}
            </strong>
          )}
        </p>
      </div>
    </div>
  );
}
