import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { SourceBadges } from "@/components/source-badge";
import { aiEnrichmentMetadata } from "@/server/food-enrichment";
import { getVisibleFood } from "@/server/foods";
import { formatDateKey } from "@/server/diary";
import { LogFoodForm } from "./log-food-form";
import { PortionProvider } from "./portion-context";
import { PortionNutrients } from "./portion-nutrients";
import { preferredInitialPortion, type FoodShape } from "./portion";
import { prisma } from "@/lib/db";
import { lastFoodPortion } from "@/server/last-portions";

export default async function FoodDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ meal?: string; date?: string; editMeal?: string }>;
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
  const sources = await prisma.foodSource.findMany({ where: { foodId: food.id }, orderBy: { retrievedAt: "desc" } });
  const source = sources.find((item) => item.provider !== "AI_ENRICHMENT");
  const definitions = await prisma.nutrientDefinition.findMany({ select: { key: true, nameDe: true, nameEn: true } });
  const names = new Map(definitions.map((item) => [item.key, user.language === "de" ? item.nameDe : item.nameEn]));
  const shape: FoodShape = {
    id: food.id,
    basisUnit: food.basisUnit,
    servingSize: food.servingSize,
    servingUnit: food.servingUnit,
    densityGPerMl: food.densityGPerMl,
    servings: food.servings,
  };
  const portion = preferredInitialPortion(shape, await lastFoodPortion(user.id, food.id));
  const enrichment = aiEnrichmentMetadata(sources).map((item) => ({ ...item, nutrientNames: item.nutrientKeys.map((key) => names.get(key) ?? key) }));

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
        <SourceBadges source={food.sourceType} enrichment={enrichment} />
      </div>

      <div className="grid-main">
        <PortionProvider initialQuantity={portion.quantity} initialUnit={portion.unit}>
          <div className="stack">
            <section className="card">
              <h2>{t("servingLabel")}</h2>
              <LogFoodForm
                food={shape}
                meal={query.meal ?? "SNACKS"}
                date={query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : today}
                returnToMeal={(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"] as string[]).includes(query.editMeal ?? "") ? query.editMeal : undefined}
              />
            </section>

            <section className="card">
              <h2>{t("form.nutrients")}</h2>
              {/* Second column: the same nutrients scaled to the portion in the form above. */}
              <PortionNutrients food={shape} nutrients={food.nutrients} basisAmount={food.basisAmount} locale={user.language} />
            </section>
          </div>
        </PortionProvider>

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
