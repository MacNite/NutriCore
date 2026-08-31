import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { EnergyRing } from "@/components/energy-ring";
import { MacroBar } from "@/components/macro-bar";
import { MicronutrientSummary } from "@/components/micronutrient-summary";
import { CoverageNotice } from "@/components/coverage-notice";
import { SourceBadge } from "@/components/source-badge";
import { QuickAddLink } from "@/components/quick-add";
import { prisma } from "@/lib/db";
import { getDiaryDay, formatDateKey, MEALS } from "@/server/diary";
import { getCurrentTarget } from "@/server/targets";
import { formatKcal, formatNumber, formatWeekday } from "@/lib/format";
import { shiftDateKey, validDateKey } from "@/lib/date";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.onboarded) redirect("/onboarding");

  const t = await getTranslations("today");
  const diaryT = await getTranslations("diary");
  const targetT = await getTranslations("target");
  const common = await getTranslations("common");
  const locale = user.language;
  const today = formatDateKey(new Date());
  const selectedDate = validDateKey((await searchParams).date, today);

  const [day, target, recent] = await Promise.all([
    getDiaryDay(user.id, selectedDate),
    getCurrentTarget(user.id),
    prisma.foodUsageStats.findMany({
      where: { userId: user.id },
      orderBy: [{ lastUsedAt: "desc" }],
      take: 5,
      include: { food: { select: { id: true, name: true, brand: true, sourceType: true } } },
    }),
  ]);

  const consumed = day.totals.energyKcal ?? 0;
  const targetKcal = target?.kcal ?? null;
  const remaining = targetKcal !== null ? targetKcal - consumed : null;

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("greeting", { name: user.displayName })}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("subtitle")}
          </p>
        </div>
        <nav className="date-nav" aria-label={diaryT("title")}>
          <Link className="btn btn-quiet" href={`/?date=${shiftDateKey(selectedDate, -1)}`} aria-label={diaryT("previousDay")}>
            <span aria-hidden="true">‹</span>
          </Link>
          <strong>{formatWeekday(selectedDate, locale)}</strong>
          <Link className="btn btn-quiet" href={`/?date=${shiftDateKey(selectedDate, 1)}`} aria-label={diaryT("nextDay")}>
            <span aria-hidden="true">›</span>
          </Link>
        </nav>
      </div>

      <div className="grid-main">
        <div className="stack">
          <section className="card" aria-labelledby="energy-heading">
            <h2 id="energy-heading" className="sr-only">
              {t("consumed", {
                consumed: formatKcal(consumed, locale),
                target: targetKcal ? formatKcal(targetKcal, locale) : "–",
              })}
            </h2>

            <div className="energy">
              <EnergyRing
                consumed={consumed}
                target={targetKcal}
                locale={locale}
                summary={t("energyRing")}
                label={
                  targetKcal
                    ? `${common("of")} ${formatKcal(targetKcal, locale)} ${common("kcal")}`
                    : common("kcal")
                }
              />

              <div>
                <MacroBar
                  label={targetT("protein")}
                  value={day.totals.protein}
                  target={target?.proteinG ?? null}
                  locale={locale}
                />
                <MacroBar
                  label={targetT("carbohydrate")}
                  value={day.totals.carbohydrate}
                  target={target?.carbohydrateG ?? null}
                  locale={locale}
                  variant="carb"
                />
                <MacroBar
                  label={targetT("fat")}
                  value={day.totals.fat}
                  target={target?.fatG ?? null}
                  locale={locale}
                  variant="fat"
                />

                <p className="muted" style={{ margin: "12px 0 0", fontSize: 13.5 }}>
                  {remaining === null ? (
                    <Link href="/settings">{t("noTarget")}</Link>
                  ) : remaining >= 0 ? (
                    <strong style={{ color: "var(--text)" }}>
                      {t("remaining", { amount: formatKcal(remaining, locale) })}
                    </strong>
                  ) : (
                    <strong style={{ color: "var(--text)" }}>
                      {t("over", { amount: formatKcal(Math.abs(remaining), locale) })}
                    </strong>
                  )}
                </p>
              </div>
            </div>
          </section>

          <section className="card" aria-labelledby="meals-heading">
            <div className="card-head">
              <h2 id="meals-heading">{diaryT("title")}</h2>
              <Link href={`/diary?date=${selectedDate}`} className="btn btn-quiet">
                {common("edit")}
              </Link>
            </div>

            {MEALS.map((meal) => {
              const mealData = day.meals.find((m) => m.meal === meal);
              const entries = mealData?.entries ?? [];
              const kcal = mealData?.totals.energyKcal ?? null;

              return (
                <div className="row" key={meal}>
                  <div className="row-body">
                    <strong>{diaryT(`meals.${meal}`)}</strong>
                    <span>
                      {entries.length === 0
                        ? diaryT("empty")
                        : entries.map((e) => e.label).slice(0, 3).join(" · ")}
                    </span>
                  </div>
                  <span className="row-value">{kcal === null ? "–" : `${formatKcal(kcal, locale)} ${common("kcal")}`}</span>
                  <QuickAddLink meal={meal} date={selectedDate} label={diaryT("addTo", { meal: diaryT(`meals.${meal}`) })} />
                </div>
              );
            })}
          </section>

          <section className="card" aria-labelledby="micronutrients-heading">
            <div className="card-head">
              <h2 id="micronutrients-heading">{diaryT("micronutrients")}</h2>
              <Link href={`/diary?date=${selectedDate}#micronutrients-heading`} className="btn btn-quiet">
                {t("allMicronutrients")}
              </Link>
            </div>
            <MicronutrientSummary
              totals={day.totals}
              knownTotals={day.knownTotals}
              coverage={day.coverage}
              locale={locale}
              compact
            />
          </section>
        </div>

        <aside className="stack">
          <section className="card" aria-labelledby="quick-heading">
            <h2 id="quick-heading">{t("quickAdd")}</h2>
            <div className="quick-grid">
              <Link className="btn" href={`/foods?date=${selectedDate}`}>
                <span aria-hidden="true">⌕</span>
                {t("searchFood")}
              </Link>
              <Link className="btn" href={`/foods?mode=barcode&date=${selectedDate}`}>
                <span aria-hidden="true">▤</span>
                {t("scanBarcode")}
              </Link>
              <Link className="btn" href={`/foods/new?date=${selectedDate}`}>
                <span aria-hidden="true">＋</span>
                {common("add")}
              </Link>
            </div>

            <CoverageNotice nutrientKey="vitaminC" coverage={day.coverage.vitaminC ?? null} locale={locale} />
          </section>

          <section className="card" aria-labelledby="recent-heading">
            <h2 id="recent-heading">{t("recent")}</h2>
            {recent.length === 0 ? (
              <p className="empty">{t("noRecent")}</p>
            ) : (
              recent.map((item) => (
                <div className="row" key={item.foodId}>
                  <div className="row-body">
                    <strong>{item.food.name}</strong>
                    <span>
                      {item.food.brand ? `${item.food.brand} · ` : ""}
                      {formatNumber(item.count, locale, 0)}×
                    </span>
                  </div>
                  <SourceBadge source={item.food.sourceType} />
                  <QuickAddLink meal="SNACKS" date={selectedDate} foodId={item.food.id} label={`${item.food.name}`} />
                </div>
              ))
            )}
          </section>
        </aside>
      </div>

      <Link className="fab" href={`/foods?date=${selectedDate}`}>
        <span aria-hidden="true">＋</span>
        {t("searchFood")}
      </Link>
    </AppShell>
  );
}
