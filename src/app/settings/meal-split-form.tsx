"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { formatKcal } from "@/lib/format";
import {
  MEAL_SPLIT_MEALS,
  MEAL_SPLIT_PRESETS,
  MEAL_SPLIT_PRESET_KEYS,
  MEAL_SPLIT_TOTAL,
  matchingPreset,
  mealTargets,
  type MealSplit,
  type MealSplitPreset,
} from "@/lib/meal-splits";
import { saveMealSplitAction, type FormState } from "@/server/profile-actions";
import type { Locale } from "@/i18n/locales";

/**
 * The reader's division of the day, with the kcal each share works out to shown
 * beside it as they type. A percentage on its own says very little - 20 % of a
 * 1.990 kcal day is a snack budget, 20 % of a 3.400 kcal day is a meal - so the
 * preview is the point of this form rather than a decoration on it.
 */
export function MealSplitForm({
  enabled,
  split,
  targetKcal,
  locale,
}: {
  enabled: boolean;
  split: MealSplit;
  targetKcal: number | null;
  locale: Locale;
}) {
  const t = useTranslations("mealSplit");
  const diaryT = useTranslations("diary");
  const common = useTranslations("common");
  const settingsT = useTranslations("settings");
  const errors = useTranslations("errors");

  const [state, action, pending] = useActionState<FormState, FormData>(saveMealSplitAction, {});
  const [showTargets, setShowTargets] = useState(enabled);
  // Held as text so a field can be empty mid-edit: forcing it back to 0 on
  // every keystroke makes the number impossible to retype.
  const [shares, setShares] = useState<Record<string, string>>(() =>
    Object.fromEntries(MEAL_SPLIT_MEALS.map((meal) => [meal, String(split[meal])])),
  );

  const numeric = Object.fromEntries(
    MEAL_SPLIT_MEALS.map((meal) => [meal, shares[meal].trim() === "" ? 0 : Number(shares[meal])]),
  ) as MealSplit;
  const total = MEAL_SPLIT_MEALS.reduce((sum, meal) => sum + (Number.isFinite(numeric[meal]) ? numeric[meal] : 0), 0);
  const balanced = total === MEAL_SPLIT_TOTAL;
  const preset = balanced ? matchingPreset(numeric) : null;

  // Exact once the shares add up, so the four previewed values sum to the day.
  // Until then each share is previewed on its own, which is enough to show what
  // a number does while it is still being typed.
  const exact = mealTargets(targetKcal, numeric);
  const previewKcal = (meal: (typeof MEAL_SPLIT_MEALS)[number]) => {
    if (targetKcal === null) return null;
    return exact ? exact[meal] : Math.round((targetKcal * (numeric[meal] || 0)) / MEAL_SPLIT_TOTAL);
  };

  const applyPreset = (key: MealSplitPreset) =>
    setShares(Object.fromEntries(MEAL_SPLIT_MEALS.map((meal) => [meal, String(MEAL_SPLIT_PRESETS[key][meal])])));

  return (
    <section className="card">
      <h2>{t("title")}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>{t("hint")}</p>

      <form action={action}>
        {state.ok ? (
          <div className="notice" role="status" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">✓</span>
            <span>{settingsT("saved")}</span>
          </div>
        ) : null}
        {state.error ? (
          <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">!</span>
            <span>{errors("validation")}</span>
          </div>
        ) : null}

        <div className="checkbox">
          <input
            id="showMealTargets"
            name="showMealTargets"
            type="checkbox"
            checked={showTargets}
            onChange={(event) => setShowTargets(event.target.checked)}
            aria-describedby="meal-targets-hint"
          />
          <div>
            <label htmlFor="showMealTargets">{t("enable")}</label>
            <div className="hint" id="meal-targets-hint">{t("enableHint")}</div>
          </div>
        </div>

        <fieldset className="target-fields">
          <legend>{t("distribution")}</legend>

          <div className="meal-split-presets" role="group" aria-label={t("presets")}>
            {MEAL_SPLIT_PRESET_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="progress-chip"
                aria-pressed={preset === key}
                onClick={() => applyPreset(key)}
              >
                {t(`presetNames.${key}`)}
              </button>
            ))}
          </div>

          <div className="field-row" style={{ marginTop: 14 }}>
            {MEAL_SPLIT_MEALS.map((meal) => {
              const kcal = previewKcal(meal);
              return (
                <div className="field" key={meal}>
                  <label htmlFor={`mealSplit-${meal}`}>{diaryT(`meals.${meal}`)} (%)</label>
                  <input
                    id={`mealSplit-${meal}`}
                    name={`mealSplit-${meal}`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="100"
                    step="1"
                    value={shares[meal]}
                    onChange={(event) => setShares((current) => ({ ...current, [meal]: event.target.value }))}
                  />
                  {/* Approximate only while the shares do not add up: once
                      they do, this is the figure the diary will show. */}
                  <span className="hint">
                    {kcal === null ? t("noTarget") : `${exact ? "" : "≈ "}${formatKcal(kcal, locale)} ${common("kcal")}`}
                  </span>
                </div>
              );
            })}
          </div>

          {/* The running total, so an unbalanced split is visible while it is
              being typed rather than only after the server refuses it. */}
          <p className={balanced ? "muted" : "notice notice-warn"} role="status" style={{ margin: 0, fontSize: 13 }}>
            {balanced ? null : <span className="notice-icon" aria-hidden="true">!</span>}
            <span>
              {t("total", { total })}
              {balanced && targetKcal !== null ? ` · ${formatKcal(targetKcal, locale)} ${common("kcal")}` : ""}
              {balanced ? "" : ` · ${t("mustTotal")}`}
            </span>
          </p>
        </fieldset>

        <button type="submit" className="btn btn-primary" disabled={pending || (showTargets && !balanced)}>
          {pending ? common("loading") : common("save")}
        </button>
      </form>
    </section>
  );
}
