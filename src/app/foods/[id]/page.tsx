import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { SourceBadge } from "@/components/source-badge";
import { getVisibleFood } from "@/server/foods";
import { formatDateKey } from "@/server/diary";
import { LogFoodForm } from "./log-food-form";
import { NutrientTable } from "@/components/nutrient-table";
import { prisma } from "@/lib/db";

export default async function FoodDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ meal?: string; date?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const query = await searchParams;

  // Authorization lives in the query: another user's food simply is not found.
  const food = await getVisibleFood(user.id, id);
  if (!food) notFound();

  const t = await getTranslations("foods");
  const today = formatDateKey(new Date());
  const source = await prisma.foodSource.findFirst({ where: { foodId: food.id }, orderBy: { retrievedAt: "desc" } });

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{food.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {food.brand ? `${food.brand} · ` : ""}
            {t("perBasis", { amount: String(food.basisAmount), unit: food.basisUnit === "ML" ? "ml" : "g" })}
          </p>
        </div>
        <SourceBadge source={food.sourceType} />
      </div>

      <div className="grid-main">
        <div className="stack">
          <section className="card">
            <h2>{t("servingLabel")}</h2>
            <LogFoodForm
              food={{
                id: food.id,
                basisUnit: food.basisUnit,
                servingSize: food.servingSize,
                servingUnit: food.servingUnit,
                densityGPerMl: food.densityGPerMl,
                servings: food.servings,
              }}
              meal={query.meal ?? "SNACKS"}
              date={query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : today}
            />
          </section>

          <section className="card">
            <h2>{t("form.nutrients")}</h2>
            <NutrientTable
              nutrients={food.nutrients}
              basisAmount={food.basisAmount}
              basisUnit={food.basisUnit}
              locale={user.language}
            />
          </section>
        </div>

        <aside>
          <section className="card">
            <h2>{t(`sourceFull.${food.sourceType}` as "sourceFull.USER")}</h2>
            <dl style={{ margin: 0, fontSize: 13.5 }}>
              {source ? (
                <>
                  <dt className="muted">Provider</dt>
                  <dd style={{ margin: "0 0 10px" }}>{source.provider}</dd>
                  <dt className="muted">ID</dt>
                  <dd style={{ margin: "0 0 10px" }}>{source.providerId ?? "–"}</dd>
                  <dt className="muted">Retrieved</dt>
                  <dd style={{ margin: "0 0 10px" }}>{source.retrievedAt.toISOString().slice(0, 10)}</dd>
                  {source.url ? (
                    <>
                      <dt className="muted">URL</dt>
                      <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
                        <a href={source.url} rel="noreferrer noopener external" target="_blank">
                          {source.url}
                        </a>
                      </dd>
                    </>
                  ) : null}
                </>
              ) : (
                <dd className="muted" style={{ margin: 0 }}>
                  {t("sourceFull.USER")}
                </dd>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
