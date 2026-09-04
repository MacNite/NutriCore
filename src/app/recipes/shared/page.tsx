import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { formatNumber } from "@/lib/format";
import { listPublications, type PublicationNutrition } from "@/server/recipe-publications";
import { getSessionUser } from "@/server/session";

export async function generateMetadata() {
  const t = await getTranslations("sharing");
  return { title: t("title") };
}

/**
 * The recipes members of this instance have shared, newest first.
 *
 * Chronological on purpose. A nutrition application is the last place that
 * should learn to promote whatever gets the most attention, and "newest first"
 * is the one order that needs no explaining and collects no behaviour to rank
 * with.
 */
export default async function SharedRecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; cursorId?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const before = params.before ? new Date(params.before) : null;
  const cursor = before && !Number.isNaN(before.getTime()) && params.cursorId ? { publishedAt: before, id: params.cursorId } : undefined;
  const { items, nextCursor } = await listPublications({ cursor });

  const t = await getTranslations("sharing");
  const recipesT = await getTranslations("recipes");
  const common = await getTranslations("common");

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted" style={{ margin: 0 }}>{t("feedHint")}</p>
        </div>
        <Link className="btn" href="/foods#recipes">{recipesT("title")}</Link>
      </div>

      <section className="card">
        {items.length === 0 ? (
          <p className="empty">{t("empty")}</p>
        ) : (
          items.map((item) => {
            const nutrition = item.nutritionSnapshot as unknown as PublicationNutrition;
            const energy = nutrition?.perServing?.energyKcal ?? null;
            return (
              <div className="row" key={item.id}>
                <div className="row-body">
                  <strong><Link href={`/recipes/shared/${item.id}`}>{item.title}</Link></strong>
                  <span>
                    {t("byAuthor", { author: item.authorNameSnapshot })}
                    {" · "}
                    {recipesT("ingredientCount", { count: item._count.ingredients })}
                    {energy === null ? "" : ` · ${formatNumber(Math.round(energy), user.language)} kcal / ${recipesT("serving")}`}
                  </span>
                  {item.description ? <span className="muted">{item.description}</span> : null}
                </div>
                <span className="muted">{item.publishedAt.toISOString().slice(0, 10)}</span>
              </div>
            );
          })
        )}
      </section>

      {nextCursor ? (
        <p style={{ marginTop: 16 }}>
          <Link
            className="btn"
            href={`/recipes/shared?before=${encodeURIComponent(nextCursor.publishedAt.toISOString())}&cursorId=${encodeURIComponent(nextCursor.id)}`}
          >
            {common("more")}
          </Link>
        </p>
      ) : null}
    </AppShell>
  );
}
