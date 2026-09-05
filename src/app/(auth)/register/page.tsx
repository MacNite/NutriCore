import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { registrationAvailable } from "@/server/registration";
import { RegisterForm } from "./register-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("signUp") };
}

export default async function RegisterPage() {
  if (await getSessionUser()) redirect("/");
  const t = await getTranslations("auth");
  // UX only. `registerAction` enforces the same policy for itself, so posting
  // to it directly gets nowhere even though this page never rendered a form.
  const open = await registrationAvailable();

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
          <h1 style={{ fontSize: 21, margin: "0 0 4px" }}>{open ? t("signUpTitle") : t("signUpClosedTitle")}</h1>
          <p className="muted" style={{ margin: "0 0 18px", fontSize: 14 }}>
            {open ? t("signUpSubtitle") : t("signUpClosedSubtitle")}
          </p>
          {open ? <RegisterForm /> : null}
        </div>

        <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: 14 }}>
          {t("haveAccount")} <Link href="/login">{t("signIn")}</Link>
        </p>
      </main>
    </div>
  );
}
