"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addWeightAction } from "@/server/food-actions";
import type { FormState } from "@/server/profile-actions";

export function WeightForm({ today }: { today: string }) {
  const t = useTranslations("progress");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(addWeightAction, {});

  return (
    <form action={action}>
      {state.ok ? (
        <div className="notice" role="status" style={{ marginBottom: 14 }}>
          <span className="notice-icon" aria-hidden="true">
            ✓
          </span>
          <span>{t("saved")}</span>
        </div>
      ) : state.error ? (
        <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
          <span className="notice-icon" aria-hidden="true">
            !
          </span>
          <span>{errors("validation")}</span>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="weight-date">{t("date")}</label>
        <input id="weight-date" name="date" type="date" defaultValue={today} required />
      </div>

      <div className="field">
        <label htmlFor="weightKg">{t("weightValue")} (kg)</label>
        <input id="weightKg" name="weightKg" type="number" min="20" max="400" step="0.1" required />
      </div>

      <div className="field">
        <label htmlFor="note">
          {t("note")} <span className="muted">({common("optional")})</span>
        </label>
        <input id="note" name="note" type="text" maxLength={500} />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? common("loading") : common("save")}
      </button>
    </form>
  );
}
