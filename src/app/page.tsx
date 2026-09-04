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
import { AiPlaceholderRow } from "@/components/ai-placeholder-row";
import { mealPlaceholders } from "@/server/ai-placeholders";
import { AutoRefresh } from "@/components/auto-refresh";
import { QuickActionsFab } from "@/components/quick-actions-fab";
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
import { FoodSearchField } from "@/components/food-search-field";
import { researchAvailability } from "@/server/research";
import { aiAvailable } from "@/server/ai-availability";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string; quickMeal?: string; editMeal?: string; error?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.onboarded) redirect("/onboarding");

  const t = await getTranslations("today");
  const diaryT = await getTranslations("diary");
  const common = await getTranslations("common");
  const aiT = await getTranslations("aiReview");
  const placeholderT = await getTranslations("aiPlaceholder");
  const activityT = await getTranslations("activity");
  const quickT = await getTranslations("quickActions");
  const locale = user.language;
  const today = formatDateKey(new Date());
  const params = await searchParams;
  const selectedDate = validDateKey(params.date, today);
  const research = researchAvailability(user);
  // No quick-meal row for a feature the user has switched off: the quick meal
  // is an AI run and nothing else, so with AI off it is a dead end. The rest of
  // the menu records a day without any AI at all, so the button itself stays.
  const aiOn = aiAvailable(user);

  const [day, target, recent, pending, activities, placeholders] = await Promise.all([
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
    // Meals the worker is still extracting. Until it finishes there is nothing
    // to log yet, so each run stands in its own meal as a placeholder that only
    // leads back to its review.
    mealPlaceholders(user.id, selectedDate),
  ]);

  const placeholderLabels = {
    name: placeholderT("name"),
    hint: placeholderT("hint"),
    queued: placeholderT("queued"),
    running: placeholderT("running"),
    tagAi: placeholderT("tagAi"),
    tagDraft: placeholderT("tagDraft"),
  };

  // The row previews the activities themselves, so a glance at the day says
  // what was done and not merely how many entries there are.
  const activityPreview = activities.entries.map((entry) => activityT(`names.${entry.activityKey}`));

  const consumed = day.totals.energyKcal ?? 0;
  const targetKcal = target?.kcal ?? null;

  return (
    <AppShell displayName={user.displayName} hasFab>
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

      {/* Only reachable in the race the action guards against: AI was switched
          off while the dialog was still open. Shown here rather than in the
          dialog, which by then is no longer rendered at all. */}
      {!aiOn && params.error === "aiDisabled" ? (
        <div className="notice notice-warn" role="alert">{diaryT("ai.errors.aiDisabled")}</div>
      ) : null}

      {/* A finished run has to reach the page that is showing its placeholder,
          or the stand-in would sit there until someone reloaded by hand. */}
      {placeholders.length ? <AutoRefresh /> : null}

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
              const mealPending = placeholders.filter((placeholder) => placeholder.meal === meal);
              // The placeholder is named in the collapsed row too: a queued meal
              // that only showed up after opening the dialog would look, from
              // the day's list, exactly like a meal that was never submitted.
              // Named once however many runs are in flight, since repeating one
              // fixed name would say nothing that the first one did not.
              const preview = [...(mealPending.length ? [placeholderLabels.name] : []), ...entries.map((e) => e.label)];

              return (
                <div className="row clickable-row" key={meal}>
                  <AppDialog
                    id={`meal-${meal}`}
                    title={diaryT(`meals.${meal}`)}
                    closeLabel={common("close")}
                    initialOpen={params.editMeal === meal}
                    triggerClassName="row-main-button"
                    trigger={<><div className="row-body"><strong>{diaryT(`meals.${meal}`)}</strong><span>{preview.length === 0 ? diaryT("empty") : preview.slice(0, 3).join(" · ")}</span></div><span className="row-value">{kcal === null ? "–" : `${formatKcal(kcal, locale)} ${common("kcal")}`}</span></>}
                    secondaryTrigger={<span aria-hidden="true">＋</span>}
                    secondaryTriggerLabel={diaryT("addTo", { meal: diaryT(`meals.${meal}`) })}
                    secondaryAutoFocusTarget=".meal-search-input"
                  >
                    <div className="dialog-toolbar"><strong>{kcal === null ? "–" : `${formatKcal(kcal, locale)} ${common("kcal")}`}</strong><FoodSearchField variant="dropdown" meal={meal} date={selectedDate} editMeal={meal} locale={locale} researchAvailable={research.available} researchUnavailableReason={research.reason} /></div>
                    {mealPending.map((placeholder) => <AiPlaceholderRow key={placeholder.id} placeholder={placeholder} labels={placeholderLabels} />)}
                    {mealPending.length ? <p className="muted" style={{ margin: "8px 0 0" }}>{placeholderT("mealHint")}</p> : null}
                    {entries.length === 0 && mealPending.length === 0 ? <p className="empty">{diaryT("empty")}</p> : entries.map((entry) => <DiaryEntryRow key={entry.id} entry={{ id: entry.id, label: entry.label, brand: entry.brand, quantity: entry.quantity, unit: entry.unit, kcal: entry.nutrients.energyKcal ?? null, sourceType: entry.sourceType }} date={selectedDate} locale={locale} badge={<SourceBadge source={entry.sourceType} />} />)}
                  </AppDialog>
                </div>
              );
            })}
          </section>

          {/* Read as one of the day's rows, like the meals above it: the names of
              what was logged rather than a count, the active calories on the
              right, and a ＋ that skips straight to picking an activity. */}
          <section className="card">
            <div className="row clickable-row">
              <AppDialog
                id="activities"
                title={activityT("title")}
                closeLabel={common("close")}
                openEvent="open-activities"
                triggerClassName="row-main-button"
                trigger={<><div className="row-body"><strong>{activityT("title")}</strong><span>{activityPreview.length === 0 ? activityT("empty") : activityPreview.slice(0, 3).join(" · ")}</span></div><span className="row-value">{activities.totalActiveKcal == null ? "–" : `${formatKcal(activities.totalActiveKcal, locale)} ${common("kcal")}`}</span></>}
                secondaryTrigger={<span aria-hidden="true">＋</span>}
                secondaryTriggerLabel={activityT("addLabel")}
                secondaryAutoClickTarget=".activity-add-button"
                secondaryAutoFocusTarget=".activity-form select"
              >
                <ActivityEditor date={selectedDate} entries={activities.entries} totalActiveKcal={activities.totalActiveKcal} locale={locale} />
              </AppDialog>
            </div>
          </section>

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

      <QuickActionsFab
        openLabel={quickT("open")}
        closeLabel={quickT("close")}
        menuLabel={quickT("menu")}
        actions={[
          { key: "recipe", label: quickT("createRecipe"), href: "/recipes/new" },
          // The day's activities are a dialog on this page already, so the row
          // opens that one instead of routing through a second copy of it.
          { key: "activity", label: quickT("addActivity"), event: "open-activities" },
          { key: "body", label: quickT("bodyCheckin"), href: "/progress?checkin=1" },
        ]}
        quickMeal={
          aiOn
            ? {
                label: quickT("describeMeal"),
                title: diaryT("ai.title"),
                hint: diaryT("ai.hint"),
                dialogCloseLabel: common("close"),
                initialOpen: params.quickMeal === "1",
                children: (
                  <>
                    {params.error && ["unsafeUrl", "inputRequired", "imageInvalid", "imageTooLarge", "imageEmpty"].includes(params.error) ? (
                      <div className="notice notice-warn">{diaryT(`ai.errors.${params.error}`)}</div>
                    ) : null}
                    <QuickMealForm date={selectedDate} returnTo="/" />
                  </>
                ),
              }
            : null
        }
      />
    </AppShell>
  );
}
