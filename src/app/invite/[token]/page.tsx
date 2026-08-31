import { getTranslations } from "next-intl/server";
import { redeemableInvitation } from "@/server/admin";
import { acceptInvitationAction } from "@/server/admin-actions";

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
  const invitation = await redeemableInvitation(token);
  const { error } = await searchParams;

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
          </>
        )}
      </section>
    </main>
  );
}
