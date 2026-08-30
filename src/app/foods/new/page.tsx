import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { CustomFoodForm } from "./custom-food-form";

export async function generateMetadata() {
  const t = await getTranslations("foods");
  return { title: t("createCustom") };
}

export default async function NewFoodPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; meal?: string; date?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const t = await getTranslations("foods");

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("createCustom")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("form.nutrientHint")}
          </p>
        </div>
      </div>

      <CustomFoodForm
        defaultName={params.name ?? ""}
        meal={params.meal ?? "SNACKS"}
        date={params.date ?? ""}
      />
    </AppShell>
  );
}
