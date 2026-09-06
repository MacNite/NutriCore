"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { AppDialog } from "./app-dialog";
import { reportFoodAction } from "@/server/food-report-actions";
import type { FormState } from "@/server/profile-actions";

/** One nutrient as the form offers it: what the food says, and a field to correct it. */
export interface ReportableNutrient {
  key: string;
  name: string;
  unit: string;
  current: number | null;
  /** The four macros, which stay open; everything else is folded away. */
  primary: boolean;
}

/**
 * Reporting a wrong value on a shared food.
 *
 * The form is deliberately the food's own nutrition table with an empty column
 * next to it: a member who noticed that a chocolate bar claims 53 kcal wants to
 * write 535 beside it, not describe the problem in prose. Every field is
 * optional and an empty one means "no opinion" - never a proposed zero - so the
 * usual report carries one or two numbers.
 *
 * Prose still has its place: the comment is what a report that cannot be
 * expressed as a number ("the brand changed the recipe", "this is the drained
 * weight") has to say, and it is the one field that can carry a report on its
 * own.
 */
export function FoodReportDialog({
  foodId,
  locale,
  nutrients,
  servingSize,
  basisUnit,
}: {
  foodId: string;
  locale: string;
  nutrients: ReportableNutrient[];
  servingSize: number | null;
  basisUnit: "G" | "ML";
}) {
  const t = useTranslations("foodReports");
  const errors = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(reportFoodAction, {});
  const form = useRef<HTMLFormElement>(null);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const unit = basisUnit === "ML" ? "ml" : "g";

  // A report that landed leaves the dialog: the page behind it has already been
  // revalidated and now shows the report's own status, which is the answer to
  // "did that work?" that a dialog staying open would hide.
  useEffect(() => {
    if (state.ok) form.current?.closest("dialog")?.close();
  }, [state.ok]);

  // The value the food carries goes in the hint rather than in a placeholder:
  // a placeholder is not announced reliably, and this is the one thing the
  // reporter is being asked to disagree with.
  const field = (nutrient: ReportableNutrient) => (
    <div className="field" key={nutrient.key}>
      <label htmlFor={`report-${nutrient.key}`}>
        {nutrient.name} ({nutrient.unit})
      </label>
      <input
        id={`report-${nutrient.key}`}
        name={`n_${nutrient.key}`}
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        aria-describedby={`report-${nutrient.key}-current`}
      />
      <span className="hint" id={`report-${nutrient.key}-current`}>
        {nutrient.current === null
          ? t("currentlyUnknown")
          : t("currently", { value: number.format(nutrient.current), unit: nutrient.unit })}
      </span>
    </div>
  );

  return (
    <AppDialog
      id="food-report"
      title={t("title")}
      closeLabel={t("close")}
      trigger={
        <>
          <span aria-hidden="true">⚑</span> {t("report")}
        </>
      }
      triggerLabel={t("report")}
    >
      <form action={action} ref={form}>
        <input type="hidden" name="foodId" value={foodId} />

        <p className="muted" style={{ marginTop: 0 }}>
          {t("intro")}
        </p>

        {state.error ? (
          <div className="notice notice-error" role="alert" style={{ marginBottom: 16 }}>
            <span className="notice-icon" aria-hidden="true">
              !
            </span>
            <span>
              {state.error.startsWith("report.")
                ? t(`error.${state.error.slice("report.".length)}` as "error.empty")
                : errors(state.error as "validation")}
            </span>
          </div>
        ) : null}

        <div className="field-row">{nutrients.filter((nutrient) => nutrient.primary).map(field)}</div>

        <details style={{ margin: "4px 0 16px" }}>
          <summary>{t("moreNutrients")}</summary>
          <div className="field-row" style={{ marginTop: 12 }}>
            {nutrients.filter((nutrient) => !nutrient.primary).map(field)}
          </div>
        </details>

        <div className="field">
          <label htmlFor="report-serving">{t("servingSize", { unit })}</label>
          <input id="report-serving" name="servingSize" type="number" min="0" step="any" inputMode="decimal" aria-describedby="report-serving-current" />
          <span className="hint" id="report-serving-current">
            {servingSize === null ? t("currentlyUnknown") : t("currently", { value: number.format(servingSize), unit })}
          </span>
        </div>

        <div className="field">
          <label htmlFor="report-comment">{t("comment")}</label>
          <textarea id="report-comment" name="comment" rows={3} maxLength={2000} placeholder={t("commentPlaceholder")} />
        </div>

        <div className="field">
          <label htmlFor="report-source">{t("sourceUrl")}</label>
          <input id="report-source" name="sourceUrl" type="url" maxLength={2000} placeholder="https://…" />
          <span className="hint">{t("sourceUrlHint")}</span>
        </div>

        <button className="btn btn-primary" disabled={pending}>
          {pending ? t("sending") : t("submit")}
        </button>
      </form>
    </AppDialog>
  );
}
