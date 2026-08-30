import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { runDiagnostics } from "@/server/diagnostics";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("diagnostics");
  return { title: t("title") };
}

const ICON: Record<string, string> = { ok: "✓", error: "×", disabled: "○", unknown: "?" };

export default async function DiagnosticsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("diagnostics");
  const checks = await runDiagnostics();

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("subtitle")}
          </p>
        </div>
        <Link className="btn" href="/settings/diagnostics">
          {t("refresh")}
        </Link>
      </div>

      <section className="card">
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">{t("title")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("title")}</th>
                <th scope="col">{t("status.unknown")}</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.key}>
                  <th scope="row" style={{ fontWeight: 500 }}>
                    {t(check.key as "database")}
                  </th>
                  <td>
                    {/* Status is icon + text, never colour alone. */}
                    <span aria-hidden="true">{ICON[check.status]}</span>{" "}
                    {t(`status.${check.status}` as "status.ok")}
                  </td>
                  <td className="muted">{check.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
