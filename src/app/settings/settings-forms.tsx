"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ProfileFields, type ProfileValues } from "@/components/profile-fields";
import type { BodyPanels } from "@/lib/body-visualization";
import { NUTRIENTS } from "@/lib/nutrients";
import {
  changeEmailAction,
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

const EMAIL_ERRORS = ["wrongPassword", "emailTaken", "sameEmail", "ssoManaged", "rateLimited"] as const;
type EmailError = (typeof EMAIL_ERRORS)[number];
const isEmailError = (error: string | undefined): error is EmailError => EMAIL_ERRORS.includes(error as EmailError);

/**
 * The sign-in address. Read-only for single-sign-on accounts, whose address
 * belongs to the identity provider and who have no password to confirm with.
 */
function EmailForm({ email, ssoManaged }: { email: string; ssoManaged: boolean }) {
  const t = useTranslations("settings.email");
  const errors = useTranslations("errors");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<FormState, FormData>(changeEmailAction, {});

  if (ssoManaged) {
    return (
      <section className="card">
        <h2>{t("title")}</h2>
        <div className="field">
          <label htmlFor="current-email">{t("current")}</label>
          <input id="current-email" type="email" value={email} readOnly aria-describedby="email-sso-hint" />
          <span className="hint" id="email-sso-hint">{t("ssoManaged")}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>{t("title")}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
        {t("hint")}
      </p>
      {/* Keyed on the saved address so a successful change clears the inputs. */}
      <form action={action} key={email}>
        {state.ok ? (
          <div className="notice" role="status" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">✓</span>
            <span>{t("saved")}</span>
          </div>
        ) : state.error ? (
          <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">!</span>
            <span>{isEmailError(state.error) ? t(`errors.${state.error}`) : errors("validation")}</span>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="current-email">{t("current")}</label>
          <input id="current-email" type="email" value={email} readOnly />
        </div>
        <div className="field">
          <label htmlFor="new-email">{t("new")}</label>
          <input id="new-email" name="email" type="email" autoComplete="email" maxLength={254} required />
        </div>
        <div className="field">
          <label htmlFor="email-password">{t("password")}</label>
          <input id="email-password" name="password" type="password" autoComplete="current-password" maxLength={200} required />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? common("loading") : t("submit")}
        </button>
      </form>
    </section>
  );
}

export function SettingsForms({
  username,
  email,
  ssoManaged,
  values,
  overrideKcal,
  manualNutrients,
  bodyPanels,
  addActivityCalories,
}: {
  username: string;
  email: string;
  ssoManaged: boolean;
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

      <EmailForm email={email} ssoManaged={ssoManaged} />

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
