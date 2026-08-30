import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { FoodSearch } from "./food-search";
import { formatDateKey } from "@/server/diary";

export async function generateMetadata() {
  const t = await getTranslations("foods");
  return { title: t("title") };
}

export default async function FoodsPage({
  searchParams,
}: {
  searchParams: Promise<{ meal?: string; date?: string; mode?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const t = await getTranslations("foods");
  const today = formatDateKey(new Date());

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("searchHint")}
          </p>
        </div>
      </div>

      <FoodSearch
        meal={params.meal ?? "SNACKS"}
        date={params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today}
        locale={user.language}
        autoFocus={params.mode !== "barcode"}
      />
    </AppShell>
  );
}
