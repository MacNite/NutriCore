"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { loginAction, type AuthState } from "@/server/auth-actions";
import { AuthError } from "@/components/auth-error";

export function LoginForm() {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<AuthState, FormData>(loginAction, {});

  return (
    <form action={action} noValidate>
      <AuthError state={state} />

      <div className="field">
        <label htmlFor="email">{t("email")}</label>
        <input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>

      <div className="field">
        <label htmlFor="password">{t("password")}</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? common("loading") : t("signIn")}
      </button>
    </form>
  );
}
