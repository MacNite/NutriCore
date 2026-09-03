import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { WeightChart } from "@/components/weight-chart";
import { WeightLog } from "@/components/weight-log";
import { NutritionProgressChart } from "@/components/nutrition-progress-chart";
import { WeightForm } from "./weight-form";
import { prisma } from "@/lib/db";
import { formatDateKey } from "@/server/diary";
import type { EntrySnapshot } from "@/server/diary";
import { aggregateNutritionDay, type ProgressTarget } from "@/lib/nutrition-progress";
import { BodyCheckinForm } from "@/components/body-progress/body-checkin-form";
import { BodyScanForm } from "@/components/body-progress/body-scan-form";
import { BodyProgressEmpty } from "@/components/body-progress/body-progress-empty";
import { BodyProgressSection } from "@/components/body-progress/body-progress-section";
import { loadBodyProgress } from "@/server/body";
import { pendingScan } from "@/server/body-scan";
import { anyPanel } from "@/lib/body-visualization";

export async function generateMetadata() {
  const t = await getTranslations("progress");
  return { title: t("title") };
}

export default async function ProgressPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("progress");
  const bodyT = await getTranslations("bodyProgress");
  const scanT = await getTranslations("bodyScan");
  const locale = user.language;

  const [entries, profile, diaryDays, nutritionTargets, body, scan] = await Promise.all([
    prisma.weightEntry.findMany({ where: { userId: user.id }, orderBy: { date: "asc" }, take: 400 }),
    prisma.userProfile.findUnique({ where: { userId: user.id }, select: { targetWeightKg: true, heightCm: true } }),
    prisma.diaryDay.findMany({ where: { userId: user.id }, include: { entries: true }, orderBy: { date: "desc" }, take: 90 }),
    prisma.nutritionTarget.findMany({ where: { userId: user.id }, orderBy: { validFrom: "asc" } }),
    loadBodyProgress(user.id),
    pendingScan(user.id),
  ]);

  const points = entries.map((entry) => ({
    date: entry.date.toISOString().slice(0, 10),
    weightKg: Number(entry.weightKg),
  }));
  const weightRows = [...entries].reverse().map((entry) => ({
    id: entry.id,
    date: entry.date.toISOString().slice(0, 10),
    weightKg: Number(entry.weightKg),
    note: entry.note,
  }));
  const targets: ProgressTarget[] = nutritionTargets.map((target) => ({
    validFrom: target.validFrom.toISOString(),
    values: {
      energyKcal: Number(target.overrideKcal ?? target.calculatedKcal) || null,
      protein: target.proteinG ? Number(target.proteinG) : null,
      carbohydrate: target.carbohydrateG ? Number(target.carbohydrateG) : null,
      fat: target.fatG ? Number(target.fatG) : null,
    },
  }));
  const nutritionPoints = [...diaryDays].reverse().flatMap((day) => {
    const date = day.date.toISOString().slice(0, 10);
    const point = aggregateNutritionDay(date, day.entries.map((entry) => {
      const snapshot = entry.nutritionSnapshot as unknown as EntrySnapshot;
      return { amount: snapshot?.amount ?? Number(entry.normalizedAmount ?? 0), nutrients: snapshot?.nutrients ?? {} };
    }), targets);
    return point ? [point] : [];
  });

  /* Both ways of recording a body sit together: a tape session and a scan
     produce the same measurements, and which one someone used is a detail of
     provenance rather than a different feature. */
  const checkinControls = (
    <>
      <BodyCheckinForm today={formatDateKey(new Date())} measurements={body.measurements} />
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
    </>
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
          table are those same measurements in another form - and the page is
          weight and nutrition, which stand on their own. */}
      {anyPanel(body.panels) ? (
        <section aria-labelledby="body-section-heading" style={{ marginBottom: 20 }}>
          <h2 id="body-section-heading" className="sr-only">
            {bodyT("title")}
          </h2>
          {body.measurements.length === 0 ? (
            <BodyProgressEmpty
              appearance={body.appearance}
              shapeStyle={body.shapeStyle}
              panels={body.panels}
              locale={locale}
              checkin={checkinControls}
            />
          ) : (
            <BodyProgressSection
              measurements={body.measurements}
              profile={body.profile}
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
          <section className="card" aria-labelledby="weight-heading">
            <h2 id="weight-heading">{t("weight")}</h2>
            {points.length === 0 ? (
              <p className="empty">{t("noWeightData")}</p>
            ) : (
              <>
                <WeightChart
                  points={points}
                  goalKg={profile?.targetWeightKg ? Number(profile.targetWeightKg) : null}
                  locale={locale}
                />

                <WeightLog rows={weightRows} locale={locale} />
              </>
            )}
          </section>

          <section className="card" aria-labelledby="nutrition-heading">
            <h2 id="nutrition-heading">{t("nutrition.title")}</h2>
            <p className="muted nutrition-subtitle">{t("nutrition.subtitle")}</p>
            {nutritionPoints.length === 0 ? <p className="empty">{t("nutrition.empty")}</p> : <NutritionProgressChart points={nutritionPoints} locale={locale} />}
          </section>
        </div>

        <aside>
          <section className="card">
            <h2>{t("addWeight")}</h2>
            <WeightForm today={formatDateKey(new Date())} />
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
