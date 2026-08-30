"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ProfileFields, type ProfileValues } from "@/components/profile-fields";
import { completeOnboardingAction, type FormState } from "@/server/profile-actions";

export function OnboardingForm({ values }: { values: ProfileValues }) {
  const t = useTranslations("onboarding");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(completeOnboardingAction, {});

  return (
    <form action={action}>
      {state.error ? (
        <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
          <span className="notice-icon" aria-hidden="true">
            !
          </span>
          <span>{errors("validation")}</span>
        </div>
      ) : null}

      <ProfileFields values={values} />

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? common("loading") : t("finish")}
      </button>
    </form>
  );
}
