"use client";

import { useTranslations } from "next-intl";

export interface ProfileValues {
  displayName: string;
  language: string;
  birthDate: string;
  heightCm: string;
  weightKg: string;
  targetWeightKg: string;
  biologicalSex: string;
  activityLevel: string;
  goal: string;
  isPregnant: boolean;
  isBreastfeeding: boolean;
}

const SEXES = ["MALE", "FEMALE", "UNSPECIFIED"] as const;
const ACTIVITIES = ["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE", "VERY_ACTIVE"] as const;
const GOALS = ["LOSE", "MAINTAIN", "GAIN", "CUSTOM"] as const;

/** Shared by onboarding and settings so the two can never drift apart. */
export function ProfileFields({ values, showLanguage = true }: { values: ProfileValues; showLanguage?: boolean }) {
  const t = useTranslations("profile");

  return (
    <>
      <div className="field">
        <label htmlFor="displayName">{t("displayName")}</label>
        <input id="displayName" name="displayName" type="text" defaultValue={values.displayName} required maxLength={80} />
      </div>

      {showLanguage ? <div className="field">
        <label htmlFor="language">{t("language")}</label>
        <select id="language" name="language" defaultValue={values.language}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </div> : <input type="hidden" name="language" value={values.language} />}

      <div className="field-row">
        <div className="field">
          <label htmlFor="birthDate">{t("birthDate")}</label>
          <input id="birthDate" name="birthDate" type="date" defaultValue={values.birthDate} max="2026-12-31" />
        </div>
        <div className="field">
          <label htmlFor="heightCm">{t("height")} (cm)</label>
          <input id="heightCm" name="heightCm" type="number" min={50} max={260} step="0.5" defaultValue={values.heightCm} />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="weightKg">{t("weight")} (kg)</label>
          <input id="weightKg" name="weightKg" type="number" min={20} max={400} step="0.1" defaultValue={values.weightKg} />
        </div>
        <div className="field">
          <label htmlFor="targetWeightKg">{t("targetWeight")} (kg)</label>
          <input
            id="targetWeightKg"
            name="targetWeightKg"
            type="number"
            min={20}
            max={400}
            step="0.1"
            defaultValue={values.targetWeightKg}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="biologicalSex">{t("biologicalSex")}</label>
        <select id="biologicalSex" name="biologicalSex" defaultValue={values.biologicalSex} aria-describedby="sex-hint">
          {SEXES.map((sex) => (
            <option key={sex} value={sex}>
              {t(`sex.${sex}`)}
            </option>
          ))}
        </select>
        <span className="hint" id="sex-hint">
          {t("biologicalSexHint")}
        </span>
      </div>

      <div className="field">
        <label htmlFor="activityLevel">{t("activityLevel")}</label>
        <select id="activityLevel" name="activityLevel" defaultValue={values.activityLevel}>
          {ACTIVITIES.map((level) => (
            <option key={level} value={level}>
              {t(`activity.${level}`)} — {t(`activity.${level}_hint`)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="goal">{t("goal")}</label>
        <select id="goal" name="goal" defaultValue={values.goal}>
          {GOALS.map((goal) => (
            <option key={goal} value={goal}>
              {t(`goals.${goal}`)}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend>{t("biologicalSex")}</legend>
        <div className="checkbox">
          <input id="isPregnant" name="isPregnant" type="checkbox" defaultChecked={values.isPregnant} />
          <label htmlFor="isPregnant">{t("pregnant")}</label>
        </div>
        <div className="checkbox">
          <input id="isBreastfeeding" name="isBreastfeeding" type="checkbox" defaultChecked={values.isBreastfeeding} />
          <label htmlFor="isBreastfeeding">{t("breastfeeding")}</label>
        </div>
      </fieldset>
    </>
  );
}
