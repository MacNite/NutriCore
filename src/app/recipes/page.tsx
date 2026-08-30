import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("recipes") };
}

export default async function RecipesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("nav");
  const common = await getTranslations("common");
  const recipes = await prisma.recipe.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { ingredients: true } } },
  });

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("recipes")}</h1>
        </div>
      </div>

      <section className="card">
        {recipes.length === 0 ? (
          <p className="empty">{common("noData")}</p>
        ) : (
          recipes.map((recipe) => (
            <div className="row" key={recipe.id}>
              <div className="row-body">
                <strong>{recipe.name}</strong>
                <span>
                  {String(recipe.servings)} × {common("of")} {recipe._count.ingredients}
                </span>
              </div>
            </div>
          ))
        )}
      </section>
    </AppShell>
  );
}
