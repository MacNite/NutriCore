"use client";

import { useTranslations } from "next-intl";
import type { AuthState } from "@/server/auth-actions";

/** Announces the failure to screen readers as soon as it appears. */
export function AuthError({ state }: { state: AuthState }) {
  const t = useTranslations("auth.errors");
  if (!state.error) return null;

  const key = state.error as "invalidCredentials";
  const message = state.error === "rateLimited" ? t("rateLimited", { seconds: state.seconds ?? 60 }) : t(key);

  return (
    <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
      <span className="notice-icon" aria-hidden="true">
        !
      </span>
      <span>{message}</span>
    </div>
  );
}
