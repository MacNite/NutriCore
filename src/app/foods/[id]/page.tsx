import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { SourceBadges } from "@/components/source-badge";
import { aiEnrichmentMetadata } from "@/server/food-enrichment";
import { ownedProposals } from "@/server/enrichment-review";
import { EnrichmentReviewPanel } from "@/components/enrichment-review-panel";
import { USER_REPORT_PROVIDER, hasOpenReport, ownReportsForFood } from "@/server/food-reports";
import { FoodReportDialog, type ReportableNutrient } from "@/components/food-report-dialog";
import { FoodReportStatus } from "@/components/food-report-status";
import { EDITABLE_KEYS, PRIMARY_KEYS, nutrientUnit } from "@/lib/nutrients";
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
  // The database or provider this food came from. The two rows the app writes
  // itself - an enrichment run and an accepted report - describe individual
  // values, not where the food is from, and naming one of them here would say
  // that a member's correction is the food's source.
  const source = sources.find((item) => item.provider !== "AI_ENRICHMENT" && item.provider !== USER_REPORT_PROVIDER);
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
  // `FoodResult` flattens nutrients to a name/number map, which loses the per
  // nutrient `origin` the AI badge is now read from, and carries no owner. Both
  // are read here rather than widened into the search-facing shape.
  const stored = await prisma.food.findUnique({
    where: { id: food.id },
    select: { ownerId: true, nutrients: { select: { nutrientKey: true, value: true, origin: true } } },
  });
  const enrichment = aiEnrichmentMetadata(stored?.nutrients ?? [], sources).map((item) => ({ ...item, nutrientNames: item.nutrientKeys.map((key) => names.get(key) ?? key) }));
  // Only the owner of a food ever sees its proposals, and only here: an
  // administrator's queue covers the shared catalogue, which is the only part
  // of it they can read anywhere else in the app.
  const proposals = stored?.ownerId === user.id ? await ownedProposals(user.id, food.id) : [];

  // Only the shared catalogue can be reported: a food somebody owns is theirs
  // to fix, and an administrator - who is the only reviewer a report has -
  // cannot read it anywhere else in the app.
  const reportable = stored?.ownerId === null;
  const [ownReports, openReport] = reportable
    ? await Promise.all([ownReportsForFood(user.id, food.id), hasOpenReport(food.id)])
    : [[], false];
  const stated = new Map((stored?.nutrients ?? []).map((item) => [item.nutrientKey, item.value === null ? null : Number(item.value)]));
  const reportNutrients: ReportableNutrient[] = EDITABLE_KEYS.map((key) => ({
    key,
    name: names.get(key) ?? key,
    unit: nutrientUnit(key),
    current: stated.get(key) ?? null,
    primary: (PRIMARY_KEYS as readonly string[]).includes(key),
  }));

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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <SourceBadges source={food.sourceType} enrichment={enrichment} />
          {reportable ? (
            <FoodReportDialog
              foodId={food.id}
              locale={user.language}
              nutrients={reportNutrients}
              servingSize={food.servingSize}
              basisUnit={food.basisUnit}
            />
          ) : null}
        </div>
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

            <FoodReportStatus reports={ownReports} openByAnyone={openReport} locale={user.language} nutrientNames={names} />

            {proposals.length ? (
              <EnrichmentReviewPanel
                proposals={proposals}
                nutrientNames={names}
                locale={user.language}
                heading={t("enrichmentReviewTitle")}
              />
            ) : null}

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
