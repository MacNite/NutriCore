import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { FoodSearch } from "./food-search";
import { formatDateKey } from "@/server/diary";
import { researchAvailability } from "@/server/research";
import { validDateKey } from "@/lib/date";
import Link from "next/link";
import { prisma } from "@/lib/db";

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
  const availability = researchAvailability(user);
  const recipes = await prisma.recipe.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { ingredients: true } } },
  });
  const recipesT = await getTranslations("recipes");
  const common = await getTranslations("common");

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
        date={validDateKey(params.date, today)}
        locale={user.language}
        autoFocus={params.mode !== "barcode"}
        researchAvailable={availability.available}
        researchUnavailableReason={availability.reason}
      />

      <section className="card" id="recipes" style={{ marginTop: 20 }} aria-labelledby="recipes-heading">
        <div className="card-head">
          <div>
            <h2 id="recipes-heading">{recipesT("title")}</h2>
            <p className="muted" style={{ margin: 0 }}>{recipesT("combinedHint")}</p>
          </div>
          <Link className="btn btn-primary" href="/recipes/new">{recipesT("create")}</Link>
        </div>
        {recipes.length === 0 ? <p className="empty">{common("noData")}</p> : recipes.map((recipe) => (
          <div className="row" key={recipe.id}>
            <div className="row-body">
              <strong><Link href={`/recipes/${recipe.id}`}>{recipe.name}</Link></strong>
              <span>{recipesT("ingredientCount", { count: recipe._count.ingredients })}</span>
            </div>
          </div>
        ))}
      </section>
    </AppShell>
  );
}
