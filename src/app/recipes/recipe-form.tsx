"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { saveRecipeAction } from "@/server/recipe-actions";
import type { FormState } from "@/server/profile-actions";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { allowedUnits } from "@/lib/units";
import { effectiveDensity } from "@/lib/density";

interface Ingredient { foodId: string; name: string; amount: number; unit: string; units?: string[] }
interface SearchResult { id: string; name: string; brand: string | null; basisUnit: "G" | "ML"; densityGPerMl: number | null; servings: { label: string; amount: number; unit: string; gramEquivalent: number | null; mlEquivalent: number | null }[] }

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
  const t = useTranslations("recipes"); const common = useTranslations("common"); const errors = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(saveRecipeAction, {});
  const [ingredients, setIngredients] = useState<Ingredient[]>(recipe?.ingredients ?? []);
  const [query, setQuery] = useState(""); const [results, setResults] = useState<SearchResult[]>([]);
  useEffect(() => { if (query.trim().length < 2) { setResults([]); return; } const controller = new AbortController(); const timer = setTimeout(async () => { const response = await fetch(`/api/foods/search?q=${encodeURIComponent(query)}`, { signal: controller.signal }); if (response.ok) setResults(((await response.json()) as { results: SearchResult[] }).results); }, 300); return () => { clearTimeout(timer); controller.abort(); }; }, [query]);
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
      <div className="field"><label htmlFor="ingredient-search">{t("searchFood")}</label>
        <div className="search-with-action">
          <input id="ingredient-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          <BarcodeScanner compact onScan={setQuery} />
        </div>
      </div>
      {results.map((food) => {
        // Through the same rule the save applies, so the dropdown cannot refuse
        // a food the AI import would convert - or offer one it would reject.
        const units = allowedUnits({ basisUnit: food.basisUnit, ...effectiveDensity(food), servings: food.servings });
        return <div className="row" key={food.id}><div className="row-body"><strong>{food.name}</strong><span>{food.brand}</span></div>
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
