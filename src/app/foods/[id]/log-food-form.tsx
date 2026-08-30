"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addEntryAction } from "@/server/diary-actions";
import type { FormState } from "@/server/profile-actions";

const MEALS = ["BREAKFAST", "LUNCH", "DINNER", "SNACKS"] as const;

interface FoodShape {
  id: string;
  basisUnit: string;
  servingSize: number | null;
  servingUnit: string | null;
  densityGPerMl: number | null;
  servings: { label: string; gramEquivalent: number | null; mlEquivalent: number | null }[];
}

export function LogFoodForm({ food, meal, date }: { food: FoodShape; meal: string; date: string }) {
  const t = useTranslations("diary");
  const foodsT = useTranslations("foods");
  const errors = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(addEntryAction, {});

  const baseUnit = food.basisUnit === "ML" ? "ml" : "g";
  // Only units that can actually be resolved are offered.
  const units = [
    baseUnit,
    ...(food.basisUnit === "ML" ? ["l"] : ["kg"]),
    ...(food.densityGPerMl ? (food.basisUnit === "ML" ? ["g"] : ["ml"]) : []),
    ...(food.servingSize && food.servingUnit ? [food.servingUnit] : []),
    ...food.servings.map((s) => s.label),
  ].filter((unit, index, all) => all.indexOf(unit) === index);

  return (
    <form action={action}>
      <input type="hidden" name="foodId" value={food.id} />
      <input type="hidden" name="date" value={date} />

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
            defaultValue={food.servingSize ?? 100}
            required
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="unit">{t("unit")}</label>
          <select id="unit" name="unit" defaultValue={food.servingUnit ?? baseUnit}>
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
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
