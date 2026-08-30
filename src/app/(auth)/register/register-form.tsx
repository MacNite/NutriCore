"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { registerAction, type AuthState } from "@/server/auth-actions";
import { AuthError } from "@/components/auth-error";

export function RegisterForm() {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<AuthState, FormData>(registerAction, {});

  return (
    <form action={action} noValidate>
      <AuthError state={state} />

      <div className="field">
        <label htmlFor="displayName">{t("displayName")}</label>
        <input id="displayName" name="displayName" type="text" autoComplete="name" required autoFocus />
      </div>

      <div className="field">
        <label htmlFor="username">{t("username")}</label>
        <input id="username" name="username" type="text" autoComplete="username" pattern="[a-zA-Z0-9._\-]+" required />
      </div>

      <div className="field">
        <label htmlFor="email">{t("email")}</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className="field">
        <label htmlFor="password">{t("password")}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          aria-describedby="password-hint"
        />
        <span className="hint" id="password-hint">
          {t("passwordHint")}
        </span>
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? common("loading") : t("signUp")}
      </button>
    </form>
  );
}
