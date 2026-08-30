import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { RegisterForm } from "./register-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("signUp") };
}

export default async function RegisterPage() {
  if (await getSessionUser()) redirect("/");
  const t = await getTranslations("auth");

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
          <h1 style={{ fontSize: 21, margin: "0 0 4px" }}>{t("signUpTitle")}</h1>
          <p className="muted" style={{ margin: "0 0 18px", fontSize: 14 }}>
            {t("signUpSubtitle")}
          </p>
          <RegisterForm />
        </div>

        <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: 14 }}>
          {t("haveAccount")} <Link href="/login">{t("signIn")}</Link>
        </p>
      </main>
    </div>
  );
}
