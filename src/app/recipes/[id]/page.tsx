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
import { ConfirmRecipeForm, DeleteRecipeForm, LogRecipeForm } from "../recipe-actions-form";
import { PublishRecipeForm, WithdrawPublicationForm } from "../publication-forms";
import { publicationForRecipe } from "@/server/recipe-publications";
import type { RecipeImportDraft } from "@/server/ai-ingestion-actions";
import { aiEnrichmentMetadata } from "@/server/food-enrichment";
import { prisma } from "@/lib/db";
import { ComponentChoice, type ChoiceLabels } from "@/app/ai-review/[id]/component-choice";
import { lastRecipePortion } from "@/server/last-portions";

export default async function RecipePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ unsaved?: string }> }) {
  const user = await getSessionUser(); if (!user) redirect("/login"); const { id } = await params;
  // Set by "save to my recipes" when a shared recipe could not be copied whole.
  const { unsaved } = await searchParams;
  const detail = await getRecipe(user.id, id); if (!detail) notFound(); const { recipe, nutrition } = detail;
  const definitions = await prisma.nutrientDefinition.findMany({ select: { key: true, nameDe: true, nameEn: true } });
  const nutrientNames = new Map(definitions.map((item) => [item.key, user.language === "de" ? item.nameDe : item.nameEn]));
  const ingredientEnrichment = (food: { nutrients: { nutrientKey: string; value: unknown | null; origin?: string | null }[]; sources: { provider: string; metadata: unknown; retrievedAt: Date }[] }) =>
    aiEnrichmentMetadata(food.nutrients, food.sources).map((item) => ({ ...item, nutrientNames: item.nutrientKeys.map((key) => nutrientNames.get(key) ?? key) }));
  const t = await getTranslations("recipes"); const common = await getTranslations("common"); const review = await getTranslations("aiReview");
  const sharing = await getTranslations("sharing");
  const draft = recipe.status === "DRAFT";
  const publication = draft ? null : await publicationForRecipe(user.id, id);
  const rememberedPortion = draft ? null : await lastRecipePortion(user.id, id);
  // What the extraction could not place. Kept on the import rather than on the
  // recipe, because it is a note about one run, not part of the recipe itself.
  const importRecord = draft && recipe.importId
    ? await prisma.aiIngestionInput.findFirst({ where: { id: recipe.importId, userId: user.id }, select: { draft: true } })
    : null;
  const extraction = (importRecord?.draft ?? null) as unknown as RecipeImportDraft | null;
  const unmatched = extraction?.unmatched ?? [];
  const unconverted = extraction?.unconverted ?? [];
  const estimatedWeights = extraction?.estimatedWeights ?? [];
  const unparsed = extraction?.unparsedIngredients ?? [];
  const aiAssisted = extraction?.aiAssistedIngredients ?? [];
  const reviewComponents = extraction?.components ?? extraction?.ingredients.map((ingredient) => ({ name: ingredient.name, quantity: ingredient.amount, unit: ingredient.unit, canonicalFoodId: ingredient.foodId, candidates: ingredient.candidates ?? [] })) ?? [];
  const choiceLabels: ChoiceLabels = { matched: review("matched"), unmatched: review("unmatched"), missingWeight: review("missingWeight"), modelEstimate: review("modelEstimate"), skip: review("skipComponent"), origin: { LOCAL: review("origin.LOCAL"), OPEN_FOOD_FACTS: review("origin.OPEN_FOOD_FACTS"), WEB_EXTRACT: review("origin.WEB_EXTRACT") }, gramsSource: { SERVING: review("gramsSource.SERVING"), PORTION: review("gramsSource.PORTION"), UNIT: review("gramsSource.UNIT"), MODEL: review("gramsSource.MODEL"), NONE: "" } };
  return <AppShell displayName={user.displayName}><div className="page-head"><div><h1>{recipe.name}</h1>{recipe.description ? <p className="muted">{recipe.description}</p> : null}{recipe.forkedFromAuthorSnapshot ? <p className="muted">{sharing("copyOf", { author: recipe.forkedFromAuthorSnapshot })}</p> : null}</div><div style={{ display: "flex", gap: 8, alignItems: "center" }}>{draft ? <span className="badge" title={t("draftHint")}>{t("draft")}</span> : null}<SourceBadge source={recipe.sourceType} /><Link className="btn" href={`/recipes/${id}/edit`}>{common("edit")}</Link></div></div>
    {unsaved ? <div className="notice notice-warn" role="status">{sharing("unsavedIngredients", { names: unsaved })}</div> : null}
    <div className="grid-main"><div className="stack"><section className="card"><h2>{t("ingredients")}</h2>{recipe.ingredients.map((item) => <div className="row" key={item.id}><div className="row-body"><strong><Link href={`/foods/${item.foodId}`}>{item.food.name}</Link></strong><span>{formatNumber(Number(item.amount), user.language)} {item.unit} · {formatNumber(Number(item.normalizedGrams), user.language)} g</span></div><SourceBadges source={item.food.sourceType} enrichment={ingredientEnrichment(item.food)} /></div>)}</section>
      <section className="card"><h2>{t("nutritionPerServing")}</h2><NutrientTable nutrients={nutrition.perServing} basisAmount={1} basisUnit={t("serving")} locale={user.language} /></section>
      {nutrition.per100g ? <section className="card"><h2>{t("nutritionPer100g")}</h2><NutrientTable nutrients={nutrition.per100g} basisAmount={100} basisUnit="G" locale={user.language} /></section> : null}
      {recipe.instructions ? <section className="card"><h2>{t("instructions")}</h2><p style={{ whiteSpace: "pre-wrap" }}>{recipe.instructions}</p></section> : null}</div>
      <aside><section className="card"><dl><dt>{t("servings")}</dt><dd>{formatNumber(Number(recipe.servings), user.language)}</dd><dt>{t("yieldWeight")}</dt><dd>{formatNumber(nutrition.finalWeightG, user.language)} g</dd><dt>{t("portionWeight")}</dt><dd>{formatNumber(nutrition.portionWeightG, user.language)} g</dd></dl>{recipe.tags.length ? <p>{recipe.tags.join(", ")}</p> : null}</section><section className="card"><h2>{t("coverage")}</h2><p>{Object.entries(nutrition.coverage).slice(0, 4).map(([key, value]) => `${key}: ${value === null ? "–" : formatPercent(value, user.language)}`).join(" · ")}</p></section><section className="card"><h2>{t("provenance")}</h2><p>{draft ? t("draftHint") : t(`source.${recipe.sourceType}` as "source.RECIPE")}</p>{recipe.sources.map((source) => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer noopener external">{source.title ?? source.url}</a>{source.retrievedAt ? ` · ${source.retrievedAt.toISOString().slice(0, 10)}` : ""}</p>)}</section>{draft
      ? <section className="card"><h2>{t("draftReview")}</h2><p className="muted">{t("draftNotice")}</p>{unmatched.length ? <p className="notice notice-warn">{t("draftUnmatched", { names: unmatched.join(", ") })}</p> : null}{unconverted.length ? <p className="notice notice-warn">{t("draftUnconverted", { names: unconverted.join(", ") })}</p> : null}{estimatedWeights.length ? <p className="notice notice-warn">{t("draftEstimatedWeights", { names: estimatedWeights.join(", ") })}</p> : null}{unparsed.length ? <p className="notice notice-warn">{t("import.unparsed", { names: unparsed.join(", ") })}</p> : null}{aiAssisted.length ? <p className="notice notice-warn">{t("import.aiAssisted", { names: aiAssisted.join(", ") })}</p> : null}<ConfirmRecipeForm id={id}>{reviewComponents.map((component, index) => <div className="row" key={`${component.name}-${index}`}><div className="row-body"><strong>{component.name}</strong><ComponentChoice component={component} index={index} labels={choiceLabels} readOnly={false} /></div></div>)}</ConfirmRecipeForm></section>
      : <section className="card"><h2>{t("log")}</h2><LogRecipeForm id={id} date={formatDateKey(new Date())} portionWeightG={nutrition.portionWeightG} initialQuantity={rememberedPortion?.quantity ?? 1} /></section>}{draft ? null : <section className="card"><h2>{sharing("shareHeading")}</h2>{publication?.status === "PUBLISHED"
      ? <><p className="muted">{sharing("publishedOn", { date: publication.publishedAt.toISOString().slice(0, 10) })}</p><p><Link href={`/recipes/shared/${publication.id}`}>{sharing("viewPublication")}</Link></p><WithdrawPublicationForm id={publication.id} recipeId={id} /></>
      : <PublishRecipeForm recipeId={id} republish={Boolean(publication)} defaults={{ title: recipe.name, description: recipe.description ?? "", instructions: recipe.instructions ?? "", tags: recipe.tags }} />}</section>}
      <section className="card"><DeleteRecipeForm id={id} /></section></aside></div>
  </AppShell>;
}
