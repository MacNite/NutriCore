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
import { AutoRefresh } from "@/components/auto-refresh";
import { AiPlaceholderRow } from "@/components/ai-placeholder-row";
import { recipePlaceholders } from "@/server/ai-placeholders";

export async function generateMetadata() {
  const t = await getTranslations("foods");
  return { title: t("title") };
}

export default async function FoodsPage({
  searchParams,
}: {
  searchParams: Promise<{ meal?: string; date?: string; mode?: string; editMeal?: string }>;
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
  // Recipes an AI run is still writing. They are listed alongside the real ones
  // so a queued import is visible where its result will appear, rather than only
  // on the page the submission happened to redirect to.
  const placeholders = await recipePlaceholders(user.id);
  const recipesT = await getTranslations("recipes");
  const placeholderT = await getTranslations("aiPlaceholder");
  const common = await getTranslations("common");
  const placeholderLabels = {
    name: placeholderT("name"),
    hint: placeholderT("hint"),
    queued: placeholderT("queued"),
    running: placeholderT("running"),
    tagAi: placeholderT("tagAi"),
    tagDraft: placeholderT("tagDraft"),
  };

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
        editMeal={(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"] as string[]).includes(params.editMeal ?? "") ? params.editMeal : undefined}
      />

      <section className="card" id="recipes" style={{ marginTop: 20 }} aria-labelledby="recipes-heading">
        <div className="card-head">
          <div>
            <h2 id="recipes-heading">{recipesT("title")}</h2>
            <p className="muted" style={{ margin: 0 }}>{recipesT("combinedHint")}</p>
          </div>
          <Link className="btn btn-primary" href="/recipes/new">{recipesT("create")}</Link>
        </div>
        {placeholders.map((placeholder) => (
          <AiPlaceholderRow key={placeholder.id} placeholder={placeholder} labels={placeholderLabels} />
        ))}
        {placeholders.length ? (
          <>
            <p className="muted" style={{ margin: "8px 0 0" }}>{placeholderT("recipeHint")}</p>
            {/* Nothing here changes until the worker is done, so the list polls
                for it: the placeholder then goes and the draft takes its place
                without the reader reloading anything. */}
            <AutoRefresh />
          </>
        ) : null}
        {recipes.length === 0 && placeholders.length === 0 ? <p className="empty">{common("noData")}</p> : recipes.map((recipe) => (
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
