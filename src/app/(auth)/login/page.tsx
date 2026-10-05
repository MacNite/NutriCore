import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { isOidcError, oidcConfig, passwordLoginEnabled } from "@/lib/oidc";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("signIn") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; local?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const t = await getTranslations("auth");
  const { error, local } = await searchParams;

  const sso = oidcConfig();
  const passwords = passwordLoginEnabled();
  /* `?local=1` is the administrators' break-glass when password sign-in is
     off: it shows the form, and `loginAction` accepts only administrators. It
     is deliberately not linked from anywhere. */
  const showPasswordForm = passwords || local === "1";
  const ssoError = isOidcError(error) || error === "rateLimited" ? error : undefined;

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="brand" style={{ justifyContent: "center", marginBottom: 20 }}>
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          NutriCore
        </div>

        <div className="card">
          <h1 style={{ fontSize: 21, margin: "0 0 4px" }}>{t("signInTitle")}</h1>
          <p className="muted" style={{ margin: "0 0 18px", fontSize: 14 }}>
            {showPasswordForm || !sso ? t("signInSubtitle") : t("ssoOnlySubtitle", { provider: sso.providerName })}
          </p>

          {ssoError ? (
            <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
              <span className="notice-icon" aria-hidden="true">
                !
              </span>
              <span>{ssoError === "rateLimited" ? t("errors.rateLimited", { seconds: 60 }) : t(`errors.${ssoError}`)}</span>
            </div>
          ) : null}

          {sso ? (
            // A plain link, not a form: the route answers with a redirect to the provider.
            <a href="/api/auth/oidc/login" className={showPasswordForm ? "btn btn-block" : "btn btn-primary btn-block"}>
              {t("signInWith", { provider: sso.providerName })}
            </a>
          ) : null}

          {sso && showPasswordForm ? (
            <p className="muted" style={{ textAlign: "center", margin: "16px 0 12px", fontSize: 13 }}>
              {t("orPassword")}
            </p>
          ) : null}

          {showPasswordForm ? <LoginForm /> : null}
        </div>

        {passwords ? (
          <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: 14 }}>
            {t("noAccount")} <Link href="/register">{t("signUp")}</Link>
          </p>
        ) : null}
      </main>
    </div>
  );
}
