import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { WeightChart } from "@/components/weight-chart";
import { NutritionProgressChart } from "@/components/nutrition-progress-chart";
import { WeightForm } from "./weight-form";
import { prisma } from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import { formatDateKey } from "@/server/diary";
import type { EntrySnapshot } from "@/server/diary";
import { aggregateNutritionDay, type ProgressTarget } from "@/lib/nutrition-progress";

export async function generateMetadata() {
  const t = await getTranslations("progress");
  return { title: t("title") };
}

export default async function ProgressPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("progress");
  const locale = user.language;

  const [entries, profile, diaryDays, nutritionTargets] = await Promise.all([
    prisma.weightEntry.findMany({ where: { userId: user.id }, orderBy: { date: "asc" }, take: 400 }),
    prisma.userProfile.findUnique({ where: { userId: user.id }, select: { targetWeightKg: true } }),
    prisma.diaryDay.findMany({ where: { userId: user.id }, include: { entries: true }, orderBy: { date: "desc" }, take: 90 }),
    prisma.nutritionTarget.findMany({ where: { userId: user.id }, orderBy: { validFrom: "asc" } }),
  ]);

  const points = entries.map((entry) => ({
    date: entry.date.toISOString().slice(0, 10),
    weightKg: Number(entry.weightKg),
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

                <div className="table-scroll" style={{ marginTop: 16 }}>
                  <table className="table">
                    <caption className="sr-only">{t("weight")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("date")}</th>
                        <th scope="col" className="num">
                          {t("weightValue")}
                        </th>
                        <th scope="col">{t("note")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...entries].reverse().slice(0, 14).map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatDate(entry.date.toISOString().slice(0, 10), locale)}</td>
                          <td className="num">{formatNumber(Number(entry.weightKg), locale)} kg</td>
                          <td>{entry.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
