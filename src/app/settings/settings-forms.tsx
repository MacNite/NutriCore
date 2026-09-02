"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ProfileFields, type ProfileValues } from "@/components/profile-fields";
import {
  deleteAccountAction,
  saveLanguageAction,
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
}: {
  username: string;
  values: ProfileValues;
  overrideKcal: number | null;
}) {
  const t = useTranslations("settings");
  const targetT = useTranslations("target");
  const profileT = useTranslations("profile");
  const common = useTranslations("common");

  const [profileState, profileAction, profilePending] = useActionState<FormState, FormData>(saveProfileAction, {});
  const [languageState, languageAction, languagePending] = useActionState<FormState, FormData>(saveLanguageAction, {});
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

      {/* Language stays here; the AI consent switches moved to /admin. It is a
          display preference every account needs, not administration. */}
      <section className="card">
        <h2>{t("language")}</h2>
        <form action={languageAction}>
          <Feedback state={languageState} savedLabel={t("saved")} />

          <div className="field">
            <label htmlFor="settings-language">{t("language")}</label>
            <select id="settings-language" name="language" defaultValue={values.language}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary" disabled={languagePending}>
            {languagePending ? common("loading") : common("save")}
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
