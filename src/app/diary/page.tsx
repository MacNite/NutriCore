import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { SourceBadge } from "@/components/source-badge";
import { DiaryEntryRow } from "@/components/diary-entry-row";
import { CopyPreviousDay } from "@/components/copy-previous-day";
import { MicronutrientSummary } from "@/components/micronutrient-summary";
import { getDiaryDay, formatDateKey, MEALS } from "@/server/diary";
import { getCurrentTarget } from "@/server/targets";
import { formatKcal, formatNumber, formatWeekday } from "@/lib/format";
import { shiftDateKey, validDateKey } from "@/lib/date";
import { queueMealInputAction } from "@/server/meal-ai-actions";

export async function generateMetadata() {
  const t = await getTranslations("diary");
  return { title: t("title") };
}

export default async function DiaryPage({ searchParams }: { searchParams: Promise<{ date?: string; error?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const today = formatDateKey(new Date());
  const date = validDateKey(params.date, today);

  const t = await getTranslations("diary");
  const common = await getTranslations("common");
  const locale = user.language;

  const [day, target] = await Promise.all([getDiaryDay(user.id, date), getCurrentTarget(user.id)]);
  const consumed = day.totals.energyKcal ?? 0;

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("snapshotNote")}
          </p>
        </div>

        <nav className="date-nav" aria-label={t("title")}>
          <Link className="btn btn-quiet" href={`/diary?date=${shiftDateKey(date, -1)}`} aria-label={t("previousDay")}>
            <span aria-hidden="true">‹</span>
          </Link>
          <strong>{formatWeekday(date, locale)}</strong>
          <Link className="btn btn-quiet" href={`/diary?date=${shiftDateKey(date, 1)}`} aria-label={t("nextDay")}>
            <span aria-hidden="true">›</span>
          </Link>
        </nav>
      </div>

      <section className="card" style={{ marginBottom: 20 }} aria-labelledby="totals-heading">
        <div className="card-head">
          <h2 id="totals-heading">{t("totals")}</h2>
          <CopyPreviousDay date={date} />
        </div>

        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">{t("totals")}</caption>
            <thead>
              <tr>
                <th scope="col">{common("kcal")}</th>
                <th scope="col" className="num">
                  Protein
                </th>
                <th scope="col" className="num">
                  Carbs
                </th>
                <th scope="col" className="num">
                  Fat
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>{formatKcal(consumed, locale)}</strong>
                  {target?.kcal ? <span className="muted"> / {formatKcal(target.kcal, locale)}</span> : null}
                </td>
                <td className="num">{day.totals.protein === null ? "–" : `${formatNumber(day.totals.protein, locale, 0)} g`}</td>
                <td className="num">
                  {day.totals.carbohydrate === null ? "–" : `${formatNumber(day.totals.carbohydrate, locale, 0)} g`}
                </td>
                <td className="num">{day.totals.fat === null ? "–" : `${formatNumber(day.totals.fat, locale, 0)} g`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 20 }} aria-labelledby="quick-meal-heading">
        <div className="card-head">
          <div>
            <h2 id="quick-meal-heading">{t("ai.title")}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {t("ai.hint")}
            </p>
          </div>
          <span className="ai-badge">AI</span>
        </div>

        {params.error === "unsafeUrl" ? <div className="notice notice-warn">{t("ai.unsafeUrl")}</div> : null}

        <form action={queueMealInputAction}>
          <input type="hidden" name="date" value={date} />
          <div className="field">
            <label htmlFor="mealText">{t("ai.describe")}</label>
            <textarea id="mealText" name="text" required maxLength={2000} placeholder={t("ai.placeholder")} />
          </div>
          <div className="field">
            <label htmlFor="sourceUrl">{t("ai.sourceUrl")}</label>
            <input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://…" />
          </div>
          <div className="field">
            <label htmlFor="mealType">{t("ai.meal")}</label>
            <select id="mealType" name="meal">
              {MEALS.map((m) => (
                <option value={m} key={m}>
                  {t(`meals.${m}`)}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary">{t("ai.submit")}</button>
        </form>
      </section>

      <details className="card micro-panel" style={{ marginBottom: 20 }} open>
        <summary className="micro-panel-toggle">
          <h2 id="micronutrients-heading">{t("micronutrients")}</h2>
          <span className="micro-panel-chevron" aria-hidden="true" />
        </summary>
        <div className="micro-panel-content" aria-labelledby="micronutrients-heading">
          <MicronutrientSummary
            totals={day.totals}
            knownTotals={day.knownTotals}
            coverage={day.coverage}
            locale={locale}
          />
        </div>
      </details>

      <div className="stack">
        {MEALS.map((meal) => {
          const mealData = day.meals.find((m) => m.meal === meal);
          const entries = mealData?.entries ?? [];

          return (
            <section className="card" key={meal} aria-labelledby={`meal-${meal}`}>
              <div className="card-head">
                <h2 id={`meal-${meal}`}>{t(`meals.${meal}`)}</h2>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: 13.5 }}>
                    {mealData?.totals.energyKcal == null
                      ? "–"
                      : `${formatKcal(mealData.totals.energyKcal, locale)} ${common("kcal")}`}
                  </span>
                  <Link className="btn btn-quiet" href={`/foods?meal=${meal}&date=${date}`}>
                    <span aria-hidden="true">＋</span> {common("add")}
                  </Link>
                </div>
              </div>

              {entries.length === 0 ? (
                <p className="empty">{t("empty")}</p>
              ) : (
                entries.map((entry) => (
                  <DiaryEntryRow
                    key={entry.id}
                    entry={{
                      id: entry.id,
                      label: entry.label,
                      brand: entry.brand,
                      quantity: entry.quantity,
                      unit: entry.unit,
                      kcal: entry.nutrients.energyKcal ?? null,
                      sourceType: entry.sourceType,
                    }}
                    date={date}
                    locale={locale}
                    badge={<SourceBadge source={entry.sourceType} />}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}
