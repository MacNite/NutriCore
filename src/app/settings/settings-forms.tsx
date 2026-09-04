"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ProfileFields, type ProfileValues } from "@/components/profile-fields";
import type { BodyPanels } from "@/lib/body-visualization";
import { NUTRIENTS } from "@/lib/nutrients";
import {
  deleteAccountAction,
  savePersonalizationAction,
  saveProfileAction,
  saveTargetOverrideAction,
  type FormState,
} from "@/server/profile-actions";

function Feedback({ state, savedLabel }: { state: FormState; savedLabel: string }) {
  const errors = useTranslations("errors");
  if (state.ok) {
    return (
      <div className="notice" role="status" style={{ marginBottom: 14 }}>
        <span className="notice-icon" aria-hidden="true">
          ✓
        </span>
        <span>{savedLabel}</span>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
        <span className="notice-icon" aria-hidden="true">
          !
        </span>
        <span>{errors("validation")}</span>
      </div>
    );
  }
  return null;
}

export function SettingsForms({
  username,
  values,
  overrideKcal,
  manualNutrients,
  bodyPanels,
  addActivityCalories,
}: {
  username: string;
  values: ProfileValues;
  overrideKcal: number | null;
  manualNutrients: Record<string, number>;
  bodyPanels: BodyPanels;
  addActivityCalories: boolean;
}) {
  const t = useTranslations("settings");
  const targetT = useTranslations("target");
  const profileT = useTranslations("profile");
  const bodyT = useTranslations("bodyProgress");
  const common = useTranslations("common");

  const [profileState, profileAction, profilePending] = useActionState<FormState, FormData>(saveProfileAction, {});
  const [targetState, targetAction, targetPending] = useActionState<FormState, FormData>(saveTargetOverrideAction, {});
  const [deleteState, deleteAction, deletePending] = useActionState<FormState, FormData>(deleteAccountAction, {});
  const [personalizationState, personalizationAction, personalizationPending] = useActionState<FormState, FormData>(savePersonalizationAction, {});

  return (
    <>
      <section className="card">
        <h2>{t("profile")}</h2>
        <form action={profileAction}>
          <Feedback state={profileState} savedLabel={profileT("saved")} />
          <ProfileFields values={values} showLanguage={false} />
          <button type="submit" className="btn btn-primary" disabled={profilePending}>
            {profilePending ? common("loading") : common("save")}
          </button>
        </form>
      </section>

      <details className="card">
        <summary><h2>{targetT("override")}</h2></summary>
        <form action={targetAction}>
          <Feedback state={targetState} savedLabel={t("saved")} />
          <div className="field">
            <label htmlFor="overrideKcal">
              {targetT("override")} (kcal)
            </label>
            <input
              id="overrideKcal"
              name="overrideKcal"
              type="number"
              min="800"
              max="8000"
              step="10"
              defaultValue={overrideKcal ?? ""}
              aria-describedby="override-hint"
            />
            <span className="hint" id="override-hint">
              {targetT("overrideHint")}
            </span>
          </div>
          {(["macro", "micro"] as const).map((group) => {
            const nutrients = NUTRIENTS.filter((nutrient) => group === "macro" ? nutrient.category === "macro" : ["secondary", "mineral", "vitamin"].includes(nutrient.category));
            return <fieldset key={group} className="target-fields">
              <legend>{targetT(group === "macro" ? "macros" : "micros")}</legend>
              <div className="form-grid">{nutrients.map((nutrient) => <div className="field" key={nutrient.key}>
                <label htmlFor={`nutrient-${nutrient.key}`}>{values.language === "de" ? nutrient.nameDe : nutrient.nameEn} ({nutrient.unit})</label>
                <input id={`nutrient-${nutrient.key}`} name={`nutrient-${nutrient.key}`} type="number" min="0.0001" max="1000000" step="any" defaultValue={manualNutrients[nutrient.key] ?? ""} />
              </div>)}</div>
            </fieldset>;
          })}
          <p className="hint">{targetT("nutrientOverrideHint")}</p>
          <button type="submit" className="btn btn-primary" disabled={targetPending}>
            {targetPending ? common("loading") : common("save")}
          </button>
        </form>
      </details>

      {/* Which body-progress visualisations to draw, and with them the key
          figures, history and table rows that are those same measurements in
          another form. A switch here only hides: the measurements behind it
          stay recorded and stay in the data export. */}
      <section className="card">
        <h2>{t("personalize")}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
          {t("personalizeHint")}
        </p>
        <form action={personalizationAction}>
          <Feedback state={personalizationState} savedLabel={t("saved")} />

          <div className="field">
            <label htmlFor="settings-language">{t("language")}</label>
            <select id="settings-language" name="language" defaultValue={values.language}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="checkbox">
            <input
              id="showBodyComposition"
              name="showBodyComposition"
              type="checkbox"
              defaultChecked={bodyPanels.composition}
              aria-describedby="composition-panel-hint"
            />
            <div>
              <label htmlFor="showBodyComposition">{bodyT("composition.title")}</label>
              <div className="hint" id="composition-panel-hint">
                {bodyT("panels.compositionHint")}
              </div>
            </div>
          </div>

          <div className="checkbox">
            <input
              id="showBodyShape"
              name="showBodyShape"
              type="checkbox"
              defaultChecked={bodyPanels.shape}
              aria-describedby="shape-panel-hint"
            />
            <div>
              <label htmlFor="showBodyShape">{bodyT("shape.title")}</label>
              <div className="hint" id="shape-panel-hint">
                {bodyT("panels.shapeHint")}
              </div>
            </div>
          </div>

          <div className="checkbox">
            <input id="addActivityCalories" name="addActivityCalories" type="checkbox" defaultChecked={addActivityCalories} aria-describedby="activity-calories-hint" />
            <div>
              <label htmlFor="addActivityCalories">{t("addActivityCalories")}</label>
              <div className="hint" id="activity-calories-hint">{t("addActivityCaloriesHint")}</div>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={personalizationPending}>
            {personalizationPending ? common("loading") : common("save")}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{t("deleteAccount")}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
          {t("deleteAccountHint")}
        </p>
        <form action={deleteAction}>
          <Feedback state={deleteState} savedLabel={t("deleted")} />
          <div className="field">
            <label htmlFor="confirm">{t("deleteConfirm")}</label>
            <input id="confirm" name="confirm" type="text" autoComplete="off" placeholder={username} required />
          </div>
          <button type="submit" className="btn btn-danger" disabled={deletePending}>
            {deletePending ? common("loading") : t("deleteAccount")}
          </button>
        </form>
      </section>
    </>
  );
}
