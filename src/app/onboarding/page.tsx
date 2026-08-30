import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { prisma } from "@/lib/db";
import { OnboardingForm } from "./onboarding-form";

export async function generateMetadata() {
  const t = await getTranslations("onboarding");
  return { title: t("title") };
}

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("onboarding");
  const targetT = await getTranslations("target");
  const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });

  return (
    <div className="shell" style={{ maxWidth: 620 }}>
      <main id="main">
        <div className="page-head">
          <div>
            <h1>{t("title")}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {t("subtitle")}
            </p>
          </div>
        </div>

        <div className="card">
          <OnboardingForm
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
          />
        </div>

        <div className="notice" style={{ marginTop: 16 }}>
          <span className="notice-icon" aria-hidden="true">
            ⓘ
          </span>
          <span>{targetT("disclaimer")}</span>
        </div>
      </main>
    </div>
  );
}
