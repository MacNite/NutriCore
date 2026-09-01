import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { DailyEnergySummary } from "@/components/daily-energy-summary";
import { MicronutrientSummary } from "@/components/micronutrient-summary";
import { CoverageNotice } from "@/components/coverage-notice";
import { SourceBadge } from "@/components/source-badge";
import { QuickAddLink } from "@/components/quick-add";
import { PendingProposals } from "@/components/pending-proposals";
import { pendingProposals } from "@/server/pending-proposals";
import { QuickMealDialog } from "@/components/quick-meal-dialog";
import { AppDialog } from "@/components/app-dialog";
import { DiaryEntryRow } from "@/components/diary-entry-row";
import { CopyPreviousDay } from "@/components/copy-previous-day";
import { QuickMealForm } from "@/components/quick-meal-form";
import { prisma } from "@/lib/db";
import { getDiaryDay, formatDateKey, MEALS } from "@/server/diary";
import { getCurrentTarget } from "@/server/targets";
import { formatKcal, formatNumber, formatWeekday } from "@/lib/format";
import { shiftDateKey, validDateKey } from "@/lib/date";
import { ActivityEditor } from "@/components/activity-panel";
import { getActivityEntries } from "@/server/activities";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string; quickMeal?: string; editMeal?: string; error?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.onboarded) redirect("/onboarding");

  const t = await getTranslations("today");
  const diaryT = await getTranslations("diary");
  const common = await getTranslations("common");
  const aiT = await getTranslations("aiReview");
  const activityT = await getTranslations("activity");
  const locale = user.language;
  const today = formatDateKey(new Date());
  const params = await searchParams;
  const selectedDate = validDateKey(params.date, today);

  const [day, target, recent, pending, activities] = await Promise.all([
    getDiaryDay(user.id, selectedDate),
    getCurrentTarget(user.id),
    prisma.foodUsageStats.findMany({
      where: { userId: user.id },
      orderBy: [{ lastUsedAt: "desc" }],
      take: 5,
      include: { food: { select: { id: true, name: true, brand: true, sourceType: true } } },
    }),
    // A proposal was previously reachable only through the redirect that
    // followed submitting a meal, so one left undecided was invisible.
    pendingProposals(user.id),
    getActivityEntries(user.id, selectedDate),
  ]);

  const consumed = day.totals.energyKcal ?? 0;
  const targetKcal = target?.kcal ?? null;

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

      <PendingProposals
        proposals={pending}
        returnTo="/"
        labels={{
          heading: aiT("pendingHeading"),
          intro: aiT("pendingIntro"),
          accept: aiT("acceptNow"),
          reject: aiT("reject"),
          review: aiT("openReview"),
          nothingLoggable: aiT("nothingLoggable"),
          skipped: aiT("skippedShort"),
        }}
      />

      <div className="grid-main">
        <div className="stack">
          <section className="card" aria-labelledby="energy-heading">
            <h2 id="energy-heading" className="sr-only">
              {t("consumed", {
                consumed: formatKcal(consumed, locale),
                target: targetKcal ? formatKcal(targetKcal, locale) : "–",
              })}
            </h2>

            <DailyEnergySummary consumed={consumed} totals={day.totals} target={target} locale={locale} />
          </section>

          <section className="card" aria-labelledby="meals-heading">
            <div className="card-head"><h2 id="meals-heading">{diaryT("title")}</h2></div>

            {MEALS.map((meal) => {
              const mealData = day.meals.find((m) => m.meal === meal);
              const entries = mealData?.entries ?? [];
              const kcal = mealData?.totals.energyKcal ?? null;

              return (
                <div className="row clickable-row" key={meal}>
                  <AppDialog
                    id={`meal-${meal}`}
                    title={diaryT(`meals.${meal}`)}
                    closeLabel={common("close")}
                    initialOpen={params.editMeal === meal}
                    triggerClassName="row-main-button"
                    trigger={<><div className="row-body"><strong>{diaryT(`meals.${meal}`)}</strong><span>{entries.length === 0 ? diaryT("empty") : entries.map((e) => e.label).slice(0, 3).join(" · ")}</span></div><span className="row-value">{kcal === null ? "–" : `${formatKcal(kcal, locale)} ${common("kcal")}`}</span></>}
                    secondaryTrigger={<span aria-hidden="true">＋</span>}
                    secondaryTriggerLabel={diaryT("addTo", { meal: diaryT(`meals.${meal}`) })}
                  >
                    <div className="dialog-toolbar"><strong>{kcal === null ? "–" : `${formatKcal(kcal, locale)} ${common("kcal")}`}</strong><Link className="btn btn-primary" href={`/foods?meal=${meal}&date=${selectedDate}&editMeal=${meal}`}><span aria-hidden="true">＋</span> {common("add")}</Link></div>
                    {entries.length === 0 ? <p className="empty">{diaryT("empty")}</p> : entries.map((entry) => <DiaryEntryRow key={entry.id} entry={{ id: entry.id, label: entry.label, brand: entry.brand, quantity: entry.quantity, unit: entry.unit, kcal: entry.nutrients.energyKcal ?? null, sourceType: entry.sourceType }} date={selectedDate} locale={locale} badge={<SourceBadge source={entry.sourceType} />} />)}
                  </AppDialog>
                </div>
              );
            })}
          </section>

          <section className="card"><AppDialog id="activities" title={activityT("title")} closeLabel={common("close")} triggerClassName="summary-trigger" trigger={<><span><strong>{activityT("title")}</strong><small>{activities.entries.length ? `${activities.entries.length} · ${activities.totalActiveKcal == null ? "–" : `${formatKcal(activities.totalActiveKcal, locale)} ${common("kcal")}`}` : activityT("empty")}</small></span><span aria-hidden="true">›</span></>}><ActivityEditor date={selectedDate} entries={activities.entries} totalActiveKcal={activities.totalActiveKcal} locale={locale} /></AppDialog></section>

          <section className="card" aria-labelledby="micronutrients-heading">
            <div className="card-head">
              <h2 id="micronutrients-heading">{diaryT("micronutrients")}</h2>
              <AppDialog id="micronutrients" title={diaryT("micronutrients")} closeLabel={common("close")} trigger={t("allMicronutrients")}><MicronutrientSummary totals={day.totals} knownTotals={day.knownTotals} coverage={day.coverage} locale={locale} /></AppDialog>
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
            <div className="copy-previous-action"><CopyPreviousDay date={selectedDate} /></div>

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

      <QuickMealDialog
        triggerLabel={diaryT("ai.quickAction")}
        title={diaryT("ai.title")}
        hint={diaryT("ai.hint")}
        closeLabel={common("close")}
        initialOpen={params.quickMeal === "1"}
      >
        {params.error && ["unsafeUrl", "inputRequired", "imageInvalid", "imageTooLarge", "imageEmpty"].includes(params.error) ? (
          <div className="notice notice-warn">{diaryT(`ai.errors.${params.error}`)}</div>
        ) : null}
        <QuickMealForm date={selectedDate} returnTo="/" />
      </QuickMealDialog>
    </AppShell>
  );
}
