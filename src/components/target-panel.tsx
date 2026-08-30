import { getTranslations } from "next-intl/server";
import { formatKcal, formatNumber } from "@/lib/format";
import type { CurrentTarget } from "@/server/targets";
import type { Locale } from "@/i18n/locales";

/** Shows every component of the estimate, not just the final number. */
export async function TargetPanel({ target, locale }: { target: CurrentTarget | null; locale: Locale }) {
  const t = await getTranslations("target");

  if (!target) {
    return (
      <section className="card">
        <h2>{t("title")}</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          {t("needsProfile")}
        </p>
      </section>
    );
  }

  const rows: [string, string][] = [];
  if (target.bmrKcal !== null) rows.push([t("bmr"), `${formatKcal(target.bmrKcal, locale)} kcal`]);
  if (target.activityMultiplier !== null) rows.push([t("activityMultiplier"), `× ${formatNumber(target.activityMultiplier, locale, 3)}`]);
  if (target.tdeeKcal !== null) rows.push([t("tdee"), `${formatKcal(target.tdeeKcal, locale)} kcal`]);
  if (target.goalAdjustmentKcal !== null) {
    const sign = target.goalAdjustmentKcal > 0 ? "+" : "";
    rows.push([t("goalAdjustment"), `${sign}${formatKcal(target.goalAdjustmentKcal, locale)} kcal`]);
  }
  if (target.calculatedKcal !== null) rows.push([t("calculated"), `${formatKcal(target.calculatedKcal, locale)} kcal`]);
  if (target.overrideKcal !== null) rows.push([t("override"), `${formatKcal(target.overrideKcal, locale)} kcal`]);

  return (
    <section className="card">
      <h2>{t("title")}</h2>

      {!target.eligible ? (
        <div className="notice notice-warn" style={{ marginBottom: 14 }}>
          <span className="notice-icon" aria-hidden="true">
            ⓘ
          </span>
          <span>{t("ineligible")}</span>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <table className="table">
          <caption className="sr-only">{t("equation")}</caption>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row" style={{ fontWeight: 500 }}>
                  {label}
                </th>
                <td className="num">{value}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">
                <strong>{t("final")}</strong>
              </th>
              <td className="num">
                <strong>{target.kcal === null ? "–" : `${formatKcal(target.kcal, locale)} kcal`}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="muted" style={{ fontSize: 13.5 }}>{t("needsProfile")}</p>
      )}

      {target.proteinG !== null ? (
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          {t("macros")}: {formatNumber(target.proteinG, locale, 0)} g / {formatNumber(target.carbohydrateG ?? 0, locale, 0)} g /{" "}
          {formatNumber(target.fatG ?? 0, locale, 0)} g
        </p>
      ) : null}

      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0, marginTop: 12 }}>
        {t("equation")} · {t("disclaimer")}
      </p>
    </section>
  );
}
