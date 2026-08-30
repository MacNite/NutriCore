import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("errors");
  const nav = await getTranslations("nav");

  return (
    <div className="auth-shell">
      <main className="auth-card card" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 21 }}>{t("notFound")}</h1>
        <p className="muted">{t("notFoundBody")}</p>
        <Link className="btn btn-primary" href="/">
          {nav("today")}
        </Link>
      </main>
    </div>
  );
}
