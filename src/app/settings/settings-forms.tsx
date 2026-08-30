"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ProfileFields, type ProfileValues } from "@/components/profile-fields";
import {
  deleteAccountAction,
  saveProfileAction,
  saveSettingsAction,
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
  aiEnabled,
  researchEnabled,
  overrideKcal,
}: {
  username: string;
  values: ProfileValues;
  aiEnabled: boolean;
  researchEnabled: boolean;
  overrideKcal: number | null;
}) {
  const t = useTranslations("settings");
  const targetT = useTranslations("target");
  const profileT = useTranslations("profile");
  const common = useTranslations("common");

  const [profileState, profileAction, profilePending] = useActionState<FormState, FormData>(saveProfileAction, {});
  const [privacyState, privacyAction, privacyPending] = useActionState<FormState, FormData>(saveSettingsAction, {});
  const [targetState, targetAction, targetPending] = useActionState<FormState, FormData>(saveTargetOverrideAction, {});
  const [deleteState, deleteAction, deletePending] = useActionState<FormState, FormData>(deleteAccountAction, {});

  return (
    <>
      <section className="card">
        <h2>{t("profile")}</h2>
        <form action={profileAction}>
          <Feedback state={profileState} savedLabel={profileT("saved")} />
          <ProfileFields values={values} />
          <button type="submit" className="btn btn-primary" disabled={profilePending}>
            {profilePending ? common("loading") : common("save")}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{targetT("override")}</h2>
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
          <button type="submit" className="btn btn-primary" disabled={targetPending}>
            {targetPending ? common("loading") : common("save")}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{t("privacy")}</h2>
        <form action={privacyAction}>
          <Feedback state={privacyState} savedLabel={t("saved")} />

          <div className="field">
            <label htmlFor="settings-language">{t("language")}</label>
            <select id="settings-language" name="language" defaultValue={values.language}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="checkbox">
            <input id="aiEnabled" name="aiEnabled" type="checkbox" defaultChecked={aiEnabled} aria-describedby="ai-hint" />
            <div>
              <label htmlFor="aiEnabled">{t("aiEnabled")}</label>
              <div className="hint" id="ai-hint">
                {t("aiEnabledHint")}
              </div>
            </div>
          </div>

          <div className="checkbox">
            <input
              id="researchEnabled"
              name="researchEnabled"
              type="checkbox"
              defaultChecked={researchEnabled}
              aria-describedby="research-hint"
            />
            <div>
              <label htmlFor="researchEnabled">{t("researchEnabled")}</label>
              <div className="hint" id="research-hint">
                {t("researchEnabledHint")}
              </div>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={privacyPending}>
            {privacyPending ? common("loading") : common("save")}
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
