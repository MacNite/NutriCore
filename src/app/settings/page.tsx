import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { getCurrentTarget } from "@/server/targets";
import { SettingsForms } from "./settings-forms";
import { TargetPanel } from "@/components/target-panel";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("settings");
  const [profile, target] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId: user.id } }),
    getCurrentTarget(user.id),
  ]);

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
        </div>
      </div>

      <div className="grid-main">
        <div className="stack">
          <SettingsForms
            username={user.username}
            values={{
              displayName: profile?.displayName ?? user.displayName,
              language: profile?.language ?? "de",
              birthDate: profile?.birthDate?.toISOString().slice(0, 10) ?? "",
              heightCm: profile?.heightCm ? String(profile.heightCm) : "",
              weightKg: profile?.weightKg ? String(profile.weightKg) : "",
              targetWeightKg: profile?.targetWeightKg ? String(profile.targetWeightKg) : "",
              biologicalSex: profile?.biologicalSex ?? "UNSPECIFIED",
              activityLevel: profile?.activityLevel ?? "MODERATE",
              goal: profile?.goal ?? "MAINTAIN",
              isPregnant: profile?.isPregnant ?? false,
              isBreastfeeding: profile?.isBreastfeeding ?? false,
            }}
            aiEnabled={profile?.aiEnabled ?? true}
            researchEnabled={profile?.researchEnabled ?? false}
            autoApproveAi={profile?.autoApproveAi ?? true}
            overrideKcal={target?.overrideKcal ?? null}
          />
        </div>

        <aside className="stack">
          <TargetPanel target={target} locale={user.language} />

          <section className="card">
            <h2>{t("dataExport")}</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
              {t("dataExportHint")}
            </p>
            <div className="stack" style={{ gap: 8 }}>
              <a className="btn btn-block" href="/api/export/json">
                {t("exportJson")}
              </a>
              <a className="btn btn-block" href="/api/export/diary.csv">
                {t("exportDiaryCsv")}
              </a>
              <a className="btn btn-block" href="/api/export/weight.csv">
                {t("exportWeightCsv")}
              </a>
            </div>
          </section>

          {user.role === "ADMIN" ? (
            <section className="card">
              <h2>{t("administration")}</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
                {t("administrationHint")}
              </p>
              <Link className="btn btn-block" href="/admin">
                {t("administration")}
              </Link>
            </section>
          ) : null}

          <section className="card">
            <h2>{t("providers")}</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
              {t("readOnlyHint")}
            </p>
            <Link href="/about/data-sources">{t("providers")}</Link>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
