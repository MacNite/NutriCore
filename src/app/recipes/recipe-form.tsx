"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { saveRecipeAction } from "@/server/recipe-actions";
import type { FormState } from "@/server/profile-actions";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { SourceBadge } from "@/components/source-badge";
import { useFoodSearch } from "@/components/use-food-search";
import { allowedUnits } from "@/lib/units";
import { effectiveDensity } from "@/lib/density";
import { formatKcal, formatNumber } from "@/lib/format";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/locales";

interface Ingredient { foodId: string; name: string; amount: number; unit: string; units?: string[] }

/**
 * What this ingredient may be measured in.
 *
 * Free text was how "2 EL" reached the save and came back as "Unbekannte
 * Einheit": the units a food can be converted from are knowable, so they are
 * offered instead of typed. A unit already on the ingredient is kept in the
 * list even when the food no longer allows it, so an existing recipe never
 * silently changes what it says.
 */
const FALLBACK_UNITS = ["g", "kg", "ml", "l"];
function unitOptions(item: Ingredient) {
  const offered = item.units?.length ? item.units : FALLBACK_UNITS;
  return offered.includes(item.unit) ? offered : [item.unit, ...offered];
}

export function RecipeForm({ recipe, createMode = false }: { recipe?: { id: string; name: string; description: string; servings: number; yieldWeightG: number | null; instructions: string; tags: string[]; ingredients: Ingredient[] }; createMode?: boolean }) {
  const t = useTranslations("recipes"); const common = useTranslations("common"); const errors = useTranslations("errors"); const foods = useTranslations("foods");
  const rawLocale = useLocale(); const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const [state, action, pending] = useActionState<FormState, FormData>(saveRecipeAction, {});
  const [ingredients, setIngredients] = useState<Ingredient[]>(recipe?.ingredients ?? []);
  // The same search the food page runs, so an ingredient can come from Open
  // Food Facts or a barcode and not only from what is already stored. Drafts
  // are left out: an unconfirmed recipe has no food entry to weigh.
  const { query, setQuery, outcome, loading, status, scan, searchExternal } = useFoodSearch({ minQueryLength: 2 });
  const results = outcome?.results ?? [];
  return <form action={action}>
    {recipe && !createMode ? <input type="hidden" name="id" value={recipe.id} /> : null}
    <input type="hidden" name="ingredients" value={JSON.stringify(ingredients.map(({ foodId, amount, unit }) => ({ foodId, amount, unit })))} />
    {state.error ? <div className="notice notice-error" role="alert"><span>{state.error.startsWith("portion.") ? errors(state.error as "portion.unknown-unit") : errors(state.error as "validation")}</span></div> : null}
    <div className="grid-main"><div className="stack"><section className="card">
      <div className="field"><label htmlFor="name">{t("name")}</label><input id="name" name="name" required maxLength={200} defaultValue={recipe?.name} /></div>
      <div className="field"><label htmlFor="description">{t("description")}</label><textarea id="description" name="description" maxLength={2000} defaultValue={recipe?.description} /></div>
      <div className="field-row"><div className="field"><label htmlFor="servings">{t("servings")}</label><input id="servings" name="servings" type="number" min="0.01" step="0.01" required defaultValue={recipe?.servings ?? 1} /></div><div className="field"><label htmlFor="yieldWeightG">{t("yieldWeight")}</label><input id="yieldWeightG" name="yieldWeightG" type="number" min="0.01" step="0.01" defaultValue={recipe?.yieldWeightG ?? ""} /><span className="hint">{t("yieldHint")}</span></div></div>
      <div className="field"><label htmlFor="instructions">{t("instructions")}</label><textarea id="instructions" name="instructions" maxLength={20000} defaultValue={recipe?.instructions} /></div>
      <div className="field"><label htmlFor="tags">{t("tags")}</label><input id="tags" name="tags" defaultValue={recipe?.tags.join(", ")} /></div>
    </section><section className="card"><h2>{t("ingredients")}</h2>
      {/* The scanner sits inside the search line, as it does in the food search:
          scanning is a way of filling this field, not a separate action. */}
      <div className="field" style={{ marginBottom: 0 }}><label htmlFor="ingredient-search">{foods("searchPlaceholder")}</label>
        <div className="search-with-action">
          {/* Enter here used to submit the recipe - from a search field, in the
              middle of assembling it. It does what it does in the food search
              instead: it asks the provider. */}
          <input id="ingredient-search" type="search" inputMode="search" value={query} placeholder={foods("searchPlaceholder")}
            autoComplete="off" aria-describedby="ingredient-search-status"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); if (query.trim().length >= 3) searchExternal(); }} />
          <BarcodeScanner compact onScan={scan} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, margin: "10px 0", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-quiet" disabled={loading || query.trim().length < 3} onClick={searchExternal}>{foods("searchExternal")}</button>
        <span id="ingredient-search-status" role="status" aria-live="polite" className="muted" style={{ fontSize: 13 }}>{status}</span>
      </div>
      {results.map((food) => {
        // Through the same rule the save applies, so the dropdown cannot refuse
        // a food the AI import would convert - or offer one it would reject.
        const units = allowedUnits({ basisUnit: food.basisUnit, ...effectiveDensity(food), servings: food.servings });
        return <div className="row" key={food.id}><div className="row-body"><strong>{food.name}</strong>
          <span>{food.brand ? `${food.brand} · ` : ""}{food.nutrients.energyKcal == null ? "–" : `${formatKcal(food.nutrients.energyKcal, locale)} kcal`} {foods("perBasis", { amount: formatNumber(food.basisAmount, locale, 0), unit: food.basisUnit === "ML" ? "ml" : "g" })}</span></div>
          {/* Which store the food came from, so a fresh Open Food Facts hit is
              distinguishable from something already in the database. */}
          <SourceBadge source={food.sourceType} />
          {/* A recipe ingredient has to end up with a weight, and a food sold by
              volume with no stored density has none. Saying so here beats adding
              it and failing the save with "Unbekannte Einheit". */}
          {units.length === 0
            ? <span className="hint">{t("needsDensity")}</span>
            : <button className="btn" type="button" onClick={() => { if (!ingredients.some((item) => item.foodId === food.id)) setIngredients([...ingredients, { foodId: food.id, name: food.name, amount: 100, unit: units[0], units }]); setQuery(""); }}>{common("add")}</button>}
        </div>;
      })}
      {ingredients.length === 0 ? <p className="empty">{t("noIngredients")}</p> : ingredients.map((item, index) => <div className="row" key={item.foodId}><div className="row-body"><strong>{item.name}</strong><div className="field-row"><div className="field"><label htmlFor={`amount-${index}`}>{t("amount")}</label><input id={`amount-${index}`} type="number" min="0.001" step="0.001" value={item.amount} onChange={(event) => setIngredients(ingredients.map((value, i) => i === index ? { ...value, amount: Number(event.target.value) } : value))} /></div><div className="field"><label htmlFor={`unit-${index}`}>{t("unit")}</label><select id={`unit-${index}`} value={item.unit} onChange={(event) => setIngredients(ingredients.map((value, i) => i === index ? { ...value, unit: event.target.value } : value))}>{unitOptions(item).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div></div></div><button className="btn btn-danger" type="button" onClick={() => setIngredients(ingredients.filter((_, i) => i !== index))}>{common("delete")}</button></div>)}
    </section></div><aside><section className="card">
      <button className="btn btn-primary btn-block" type="submit" disabled={pending || ingredients.length === 0}>{pending ? common("loading") : common("save")}</button>
      {/* A draft keeps a half-finished recipe without making it loggable: it
          gets no Food entry, exactly like an unconfirmed AI extraction. */}
      <button className="btn btn-block" type="submit" name="status" value="DRAFT" disabled={pending || ingredients.length === 0} style={{ marginTop: 8 }}>{t("saveDraft")}</button>
      <span className="hint">{t("saveDraftHint")}</span>
    </section></aside></div>
  </form>;
}
