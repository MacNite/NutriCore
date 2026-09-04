"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addEntryAction } from "@/server/diary-actions";
import type { FormState } from "@/server/profile-actions";
import { portionUnits, type FoodShape } from "./portion";
import { usePortion } from "./portion-context";

const MEALS = ["BREAKFAST", "LUNCH", "DINNER", "SNACKS"] as const;

export function LogFoodForm({ food, meal, date, returnToMeal }: { food: FoodShape; meal: string; date: string; returnToMeal?: string }) {
  const t = useTranslations("diary");
  const foodsT = useTranslations("foods");
  const errors = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(addEntryAction, {});
  // Shared with the nutrient table, which previews the values for this portion.
  const { quantity, unit, setQuantity, setUnit } = usePortion();

  // Only units that can actually be resolved are offered.
  const units = portionUnits(food);

  return (
    <form action={action}>
      <input type="hidden" name="foodId" value={food.id} />
      <input type="hidden" name="date" value={date} />
      {returnToMeal ? <input type="hidden" name="returnToMeal" value={returnToMeal} /> : null}

      {state.error ? (
        <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
          <span className="notice-icon" aria-hidden="true">
            !
          </span>
          <span>
            {state.error === "portion.density-required"
              ? foodsT("form.densityHint")
              : state.error === "notFound"
                ? errors("notFound")
                : errors("validation")}
          </span>
        </div>
      ) : state.ok ? (
        <div className="notice" role="status" style={{ marginBottom: 14 }}>
          <span className="notice-icon" aria-hidden="true">
            ✓
          </span>
          <span>{t("entryAdded")}</span>
        </div>
      ) : null}

      <div className="field-row">
        <div className="field">
          <label htmlFor="quantity">{t("amount")}</label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            min="0.1"
            step="0.1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="unit">{t("unit")}</label>
          <select id="unit" name="unit" value={unit} onChange={(event) => setUnit(event.target.value)}>
            {units.map((option) => (
              <option key={option} value={option}>
                {option === "serving" ? foodsT("servingLabel") : option}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="meal">{t("moveTo")}</label>
          <select id="meal" name="meal" defaultValue={meal}>
            {MEALS.map((option) => (
              <option key={option} value={option}>
                {t(`meals.${option}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? "…" : t("addTo", { meal: t(`meals.${meal as "SNACKS"}`) })}
      </button>
    </form>
  );
}
