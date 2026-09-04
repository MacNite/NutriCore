import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { formatDateKey } from "@/server/diary";
import type { EntrySnapshot } from "@/server/diary";
import { aggregateNutritionDay, type ProgressTarget } from "@/lib/nutrition-progress";
import { BodyCheckinForm } from "@/components/body-progress/body-checkin-form";
import { BodyScanForm } from "@/components/body-progress/body-scan-form";
import { BodyProgressEmpty } from "@/components/body-progress/body-progress-empty";
import { BodyProgressSection } from "@/components/body-progress/body-progress-section";
import { BodyMeasurementChart } from "@/components/body-progress/body-measurement-chart";
import { loadBodyProgress } from "@/server/body";
import { pendingScan } from "@/server/body-scan";
import { anyPanel } from "@/lib/body-visualization";

export async function generateMetadata() {
  const t = await getTranslations("progress");
  return { title: t("title") };
}

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ checkin?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("progress");
  const bodyT = await getTranslations("bodyProgress");
  const scanT = await getTranslations("bodyScan");
  const locale = user.language;
  // Today's quick-action menu links here for a measurement, so the form it
  // means opens by itself instead of leaving the reader to find it.
  const params = await searchParams;

  const [profile, diaryDays, nutritionTargets, activityEntries, body, scan] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId: user.id }, select: { heightCm: true, addActivityCalories: true } }),
    prisma.diaryDay.findMany({ where: { userId: user.id }, include: { entries: true }, orderBy: { date: "desc" }, take: 90 }),
    prisma.nutritionTarget.findMany({ where: { userId: user.id }, orderBy: { validFrom: "asc" } }),
    prisma.activityEntry.findMany({ where: { userId: user.id }, orderBy: { date: "asc" }, take: 1000 }),
    loadBodyProgress(user.id),
    pendingScan(user.id),
  ]);

  const activityByDate = new Map<string, number>();
  for (const entry of activityEntries) {
    if (entry.activeKcalSnapshot === null) continue;
    const date = entry.date.toISOString().slice(0, 10);
    activityByDate.set(date, (activityByDate.get(date) ?? 0) + Number(entry.activeKcalSnapshot));
  }
  const activityPoints = [...activityByDate].map(([date, activeKcal]) => ({ date, activeKcal }));

  const targets: ProgressTarget[] = nutritionTargets.map((target) => ({
    validFrom: target.validFrom.toISOString(),
    values: {
      energyKcal: Number(target.overrideKcal ?? target.calculatedKcal) || null,
      protein: target.proteinG ? Number(target.proteinG) : null,
      carbohydrate: target.carbohydrateG ? Number(target.carbohydrateG) : null,
      fat: target.fatG ? Number(target.fatG) : null,
      ...((target.manualNutrients && typeof target.manualNutrients === "object" && !Array.isArray(target.manualNutrients)) ? target.manualNutrients as Record<string, number> : {}),
    },
  }));
  const nutritionPoints = [...diaryDays].reverse().flatMap((day) => {
    const date = day.date.toISOString().slice(0, 10);
    const dailyTargets = targets.map((target) => ({ ...target, values: { ...target.values, energyKcal: profile?.addActivityCalories !== false && target.values.energyKcal != null ? target.values.energyKcal + (activityByDate.get(date) ?? 0) : target.values.energyKcal } }));
    const point = aggregateNutritionDay(date, day.entries.map((entry) => {
      const snapshot = entry.nutritionSnapshot as unknown as EntrySnapshot;
      return { amount: snapshot?.amount ?? Number(entry.normalizedAmount ?? 0), nutrients: snapshot?.nutrients ?? {} };
    }), dailyTargets);
    return point ? [point] : [];
  });

  /* The one chart on the page lives in the body section, which needs both a
     visualisation switched on and something measured to hang it from. */
  const chartInBodySection = anyPanel(body.panels) && body.measurements.length > 0;

  /* Both ways of recording a body sit together: a tape session and a scan
     produce the same measurements, and which one someone used is a detail of
     provenance rather than a different feature. */
  const checkinControls = (
    <span className="body-checkin-actions">
      <BodyCheckinForm today={formatDateKey(new Date())} measurements={body.measurements} initialOpen={params.checkin === "1"} />
      <BodyScanForm
        today={formatDateKey(new Date())}
        heightCm={profile?.heightCm ? Number(profile.heightCm) : null}
      />
      {/* The way back to a scan already in flight. Starting one redirects to
          its page, and without this that page was the only route to it: leaving
          it lost the scan, which reads as the scan having been dropped. */}
      {scan ? (
        <Link className="btn btn-quiet" href={`/body-scan/${scan.id}`}>
          {scanT(scan.state === "AWAITING_REVIEW" ? "capture.pendingReview" : "capture.pendingWorking")}
        </Link>
      ) : null}
    </span>
  );

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("dayToDayNote")}
          </p>
        </div>

      </div>

      {/* Body progress leads the page: it answers "what shape am I in" before
          the day-to-day numbers below it. With both visualisations switched off
          the section is not rendered at all - its key figures, history and
          charts are those same measurements in another form - and the page is
          weight and nutrition, which stand on their own. */}
      {anyPanel(body.panels) ? (
        <section aria-labelledby="body-section-heading" style={{ marginBottom: 20 }}>
          <h2 id="body-section-heading" className="sr-only">
            {bodyT("title")}
          </h2>
          {chartInBodySection ? (
            <BodyProgressSection
              measurements={body.measurements}
              profile={body.profile}
              appearance={body.appearance}
              shapeStyle={body.shapeStyle}
              panels={body.panels}
              nutritionPoints={nutritionPoints}
              activityPoints={activityPoints}
              locale={locale}
              checkin={checkinControls}
            />
          ) : (
            <BodyProgressEmpty
              appearance={body.appearance}
              shapeStyle={body.shapeStyle}
              panels={body.panels}
              locale={locale}
              checkin={checkinControls}
            />
          )}
        </section>
      ) : null}

      <div className="grid-main">
        <div className="stack">
          {/* Nutrition and the calories sport added normally ride along in the
              body section's one chart. Without a measurement to plot them
              against there is no such chart, so they get their own card rather
              than falling off the page. */}
          {chartInBodySection ? null : nutritionPoints.length === 0 && activityPoints.length === 0 ? (
            <section className="card" aria-labelledby="nutrition-heading">
              <h2 id="nutrition-heading">{t("nutrition.title")}</h2>
              <p className="muted nutrition-subtitle">{t("nutrition.subtitle")}</p>
              <p className="empty">{t("nutrition.empty")}</p>
            </section>
          ) : (
            <BodyMeasurementChart
              measurements={[]}
              referenceIndex={0}
              currentIndex={0}
              metrics={[]}
              nutritionPoints={nutritionPoints}
              activityPoints={activityPoints}
              profile={body.profile}
              locale={locale}
            />
          )}
        </div>

        {/* With both visualisations switched off the body section above is not
            rendered, and with it went the only way to record a measurement at
            all - including the one Today's quick-action menu links to. That
            check-in is the only thing the column carries, so with the section
            on screen there is no column. */}
        {anyPanel(body.panels) ? null : (
          <aside className="stack">
            <section className="card">
              <h2>{bodyT("checkin.title")}</h2>
              {checkinControls}
            </section>
          </aside>
        )}
      </div>
    </AppShell>
  );
}
