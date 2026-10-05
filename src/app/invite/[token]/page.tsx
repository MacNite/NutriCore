import { getTranslations } from "next-intl/server";
import { redeemableInvitation } from "@/server/admin";
import { acceptInvitationAction } from "@/server/admin-actions";
import { oidcConfig, passwordLoginEnabled } from "@/lib/oidc";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: t("inviteTitle") };
}

export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("account");
  const auth = await getTranslations("auth");
  const invitation = await redeemableInvitation(token);
  const { error } = await searchParams;
  const sso = oidcConfig();

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <h1>{t("inviteTitle")}</h1>
        {!invitation ? (
          <div className="notice notice-warn">{t("inviteInvalid")}</div>
        ) : (
          <>
            <p>{t("inviteIntro", { email: invitation.email })}</p>
            {error ? <div className="notice notice-warn">{t("inviteError")}</div> : null}
            {sso ? (
              <>
                {/* The invitation is honoured on the first single sign-on with its email. */}
                <p>{t("inviteSso", { provider: sso.providerName, email: invitation.email })}</p>
                <a href="/api/auth/oidc/login" className="btn btn-primary btn-block" style={{ marginBottom: 16 }}>
                  {auth("signInWith", { provider: sso.providerName })}
                </a>
              </>
            ) : null}
            {passwordLoginEnabled() ? (
              <form action={acceptInvitationAction}>
                <input type="hidden" name="token" value={token} />
                <div className="field">
                  <label htmlFor="username">{t("username")}</label>
                  <input id="username" name="username" minLength={3} maxLength={40} required />
                </div>
                <div className="field">
                  <label htmlFor="password">{t("password")}</label>
                  <input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" />
                </div>
                <button className="btn btn-primary">{t("createAccount")}</button>
              </form>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
