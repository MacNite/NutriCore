import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { NutrientTable } from "@/components/nutrient-table";
import { SourceBadge, SourceBadges } from "@/components/source-badge";
import { formatNumber, formatPercent } from "@/lib/format";
import { formatDateKey } from "@/server/diary";
import { getRecipe } from "@/server/recipes";
import { getSessionUser } from "@/server/session";
import { DeleteRecipeForm, LogRecipeForm } from "../recipe-actions-form";
import { aiEnrichmentMetadata } from "@/server/food-enrichment";
import { prisma } from "@/lib/db";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(); if (!user) redirect("/login"); const { id } = await params;
  const detail = await getRecipe(user.id, id); if (!detail) notFound(); const { recipe, nutrition } = detail;
  const definitions = await prisma.nutrientDefinition.findMany({ select: { key: true, nameDe: true, nameEn: true } });
  const nutrientNames = new Map(definitions.map((item) => [item.key, user.language === "de" ? item.nameDe : item.nameEn]));
  const ingredientEnrichment = (sources: { provider: string; metadata: unknown; retrievedAt: Date }[]) => aiEnrichmentMetadata(sources).map((item) => ({ ...item, nutrientNames: item.nutrientKeys.map((key) => nutrientNames.get(key) ?? key) }));
  const t = await getTranslations("recipes"); const common = await getTranslations("common");
  return <AppShell displayName={user.displayName}><div className="page-head"><div><h1>{recipe.name}</h1>{recipe.description ? <p className="muted">{recipe.description}</p> : null}</div><div style={{ display: "flex", gap: 8 }}><SourceBadge source={recipe.sourceType} /><Link className="btn" href={`/recipes/${id}/edit`}>{common("edit")}</Link></div></div>
    <div className="grid-main"><div className="stack"><section className="card"><h2>{t("ingredients")}</h2>{recipe.ingredients.map((item) => <div className="row" key={item.id}><div className="row-body"><strong><Link href={`/foods/${item.foodId}`}>{item.food.name}</Link></strong><span>{formatNumber(Number(item.amount), user.language)} {item.unit} · {formatNumber(Number(item.normalizedGrams), user.language)} g</span></div><SourceBadges source={item.food.sourceType} enrichment={ingredientEnrichment(item.food.sources)} /></div>)}</section>
      <section className="card"><h2>{t("nutritionPerServing")}</h2><NutrientTable nutrients={nutrition.perServing} basisAmount={1} basisUnit={t("serving")} locale={user.language} /></section>
      {nutrition.per100g ? <section className="card"><h2>{t("nutritionPer100g")}</h2><NutrientTable nutrients={nutrition.per100g} basisAmount={100} basisUnit="G" locale={user.language} /></section> : null}
      {recipe.instructions ? <section className="card"><h2>{t("instructions")}</h2><p style={{ whiteSpace: "pre-wrap" }}>{recipe.instructions}</p></section> : null}</div>
      <aside><section className="card"><dl><dt>{t("servings")}</dt><dd>{formatNumber(Number(recipe.servings), user.language)}</dd><dt>{t("yieldWeight")}</dt><dd>{formatNumber(nutrition.finalWeightG, user.language)} g</dd><dt>{t("portionWeight")}</dt><dd>{formatNumber(nutrition.portionWeightG, user.language)} g</dd></dl>{recipe.tags.length ? <p>{recipe.tags.join(", ")}</p> : null}</section><section className="card"><h2>{t("coverage")}</h2><p>{Object.entries(nutrition.coverage).slice(0, 4).map(([key, value]) => `${key}: ${value === null ? "–" : formatPercent(value, user.language)}`).join(" · ")}</p></section><section className="card"><h2>{t("provenance")}</h2><p>{t(`source.${recipe.sourceType}` as "source.RECIPE")}</p>{recipe.sources.map((source) => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer noopener external">{source.title ?? source.url}</a>{source.retrievedAt ? ` · ${source.retrievedAt.toISOString().slice(0, 10)}` : ""}</p>)}</section><section className="card"><h2>{t("log")}</h2><LogRecipeForm id={id} date={formatDateKey(new Date())} portionWeightG={nutrition.portionWeightG} /></section><section className="card"><DeleteRecipeForm id={id} /></section></aside></div>
  </AppShell>;
}
