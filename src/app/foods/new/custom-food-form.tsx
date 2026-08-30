"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { createFoodAction } from "@/server/food-actions";
import type { FormState } from "@/server/profile-actions";
import { NUTRIENTS } from "@/lib/nutrients";

const PRIMARY = ["energyKcal", "protein", "carbohydrate", "fat"];

export function CustomFoodForm({
  defaultName,
  meal,
  date,
}: {
  defaultName: string;
  meal: string;
  date: string;
}) {
  const t = useTranslations("foods.form");
  const nutrients = useTranslations("nutrients");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(createFoodAction, {});

  const primary = NUTRIENTS.filter((n) => PRIMARY.includes(n.key));
  const secondary = NUTRIENTS.filter((n) => !PRIMARY.includes(n.key) && n.key !== "energyKj");

  return (
    <form action={action}>
      <input type="hidden" name="meal" value={meal} />
      <input type="hidden" name="date" value={date} />

      {state.error ? (
        <div className="notice notice-error" role="alert" style={{ marginBottom: 16 }}>
          <span className="notice-icon" aria-hidden="true">
            !
          </span>
          <span>{errors("validation")}</span>
        </div>
      ) : null}

      <div className="grid-main">
        <div className="stack">
          <section className="card">
            <h2>{t("name")}</h2>

            <div className="field">
              <label htmlFor="name">{t("name")}</label>
              <input id="name" name="name" type="text" defaultValue={defaultName} required maxLength={200} autoFocus />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="brand">{t("brand")}</label>
                <input id="brand" name="brand" type="text" maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="barcode">{t("barcode")}</label>
                <input id="barcode" name="barcode" type="text" inputMode="numeric" pattern="\d{8,14}" />
              </div>
            </div>

            <fieldset>
              <legend>{t("basis")}</legend>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="basisAmount">{common("add")}</label>
                  <input id="basisAmount" name="basisAmount" type="number" min="1" step="1" defaultValue={100} required />
                </div>
                <div className="field">
                  <label htmlFor="basisUnit">{t("basis")}</label>
                  <select id="basisUnit" name="basisUnit" defaultValue="G">
                    <option value="G">g</option>
                    <option value="ML">ml</option>
                  </select>
                </div>
              </div>
            </fieldset>

            <div className="field-row">
              <div className="field">
                <label htmlFor="servingSize">{t("servingSize")}</label>
                <input id="servingSize" name="servingSize" type="number" min="0" step="0.1" />
              </div>
              <div className="field">
                <label htmlFor="servingUnit">{t("servingSize")} ({common("optional")})</label>
                <input id="servingUnit" name="servingUnit" type="text" maxLength={40} placeholder="g" />
              </div>
            </div>

            <div className="field">
              <label htmlFor="densityGPerMl">{t("density")}</label>
              <input
                id="densityGPerMl"
                name="densityGPerMl"
                type="number"
                min="0"
                step="0.001"
                aria-describedby="density-hint"
              />
              <span className="hint" id="density-hint">
                {t("densityHint")}
              </span>
            </div>
          </section>

          <section className="card">
            <h2>{t("nutrients")}</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              {t("nutrientHint")}
            </p>

            <div className="field-row">
              {primary.map((nutrient) => (
                <div className="field" key={nutrient.key}>
                  <label htmlFor={`n_${nutrient.key}`}>
                    {nutrients(nutrient.key as "protein")} ({nutrient.unit})
                  </label>
                  <input id={`n_${nutrient.key}`} name={`n_${nutrient.key}`} type="number" min="0" step="0.01" />
                </div>
              ))}
            </div>

            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>{t("nutrients")}</summary>
              <div className="field-row" style={{ marginTop: 14 }}>
                {secondary.map((nutrient) => (
                  <div className="field" key={nutrient.key}>
                    <label htmlFor={`n_${nutrient.key}`}>
                      {nutrients(nutrient.key as "protein")} ({nutrient.unit})
                    </label>
                    <input id={`n_${nutrient.key}`} name={`n_${nutrient.key}`} type="number" min="0" step="0.001" />
                  </div>
                ))}
              </div>
            </details>
          </section>
        </div>

        <aside>
          <section className="card">
            <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
              {pending ? common("loading") : common("save")}
            </button>
          </section>
        </aside>
      </div>
    </form>
  );
}
