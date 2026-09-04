import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { NutrientTable } from "@/components/nutrient-table";
import { SourceBadge } from "@/components/source-badge";
import { formatNumber, formatPercent } from "@/lib/format";
import { getPublication } from "@/server/recipe-publications";
import { getSessionUser } from "@/server/session";
import { SavePublicationForm, WithdrawPublicationForm } from "../../publication-forms";

export default async function SharedRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const detail = await getPublication(user.id, id);
  if (!detail) notFound();
  const { publication, nutrition, isAuthor, savedRecipeId } = detail;

  const t = await getTranslations("sharing");
  const recipesT = await getTranslations("recipes");

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{publication.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("byAuthor", { author: publication.authorNameSnapshot })} · {publication.publishedAt.toISOString().slice(0, 10)}
          </p>
          {publication.description ? <p className="muted">{publication.description}</p> : null}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {publication.status === "WITHDRAWN" ? <span className="badge">{t("withdrawn")}</span> : null}
          <Link className="btn" href="/recipes/shared">{t("title")}</Link>
        </div>
      </div>

      <div className="grid-main">
        <div className="stack">
          <section className="card">
            <h2>{recipesT("ingredients")}</h2>
            {publication.ingredients.map((item) => (
              <div className="row" key={item.position}>
                <div className="row-body">
                  {/* Deliberately not a link. The publication names the food it
                      was made with; it does not hand out the author's row. */}
                  <strong>{item.displayName}{item.brand ? ` · ${item.brand}` : ""}</strong>
                  <span>
                    {formatNumber(Number(item.amount), user.language)} {item.unit} · {formatNumber(Number(item.weightG), user.language)} g
                  </span>
                </div>
                <SourceBadge source={item.sourceType} />
              </div>
            ))}
          </section>

          <section className="card">
            <h2>{recipesT("nutritionPerServing")}</h2>
            <NutrientTable nutrients={nutrition.perServing} basisAmount={1} basisUnit={recipesT("serving")} locale={user.language} />
          </section>

          {nutrition.per100g ? (
            <section className="card">
              <h2>{recipesT("nutritionPer100g")}</h2>
              <NutrientTable nutrients={nutrition.per100g} basisAmount={100} basisUnit="G" locale={user.language} />
            </section>
          ) : null}

          {publication.instructions ? (
            <section className="card">
              <h2>{recipesT("instructions")}</h2>
              <p style={{ whiteSpace: "pre-wrap" }}>{publication.instructions}</p>
            </section>
          ) : null}
        </div>

        <aside>
          <section className="card">
            <dl>
              <dt>{recipesT("servings")}</dt>
              <dd>{formatNumber(Number(publication.servings), user.language)}</dd>
              <dt>{recipesT("portionWeight")}</dt>
              <dd>{formatNumber(nutrition.portionWeightG, user.language)} g</dd>
            </dl>
            {publication.tags.length ? <p>{publication.tags.join(", ")}</p> : null}
          </section>

          <section className="card">
            <h2>{recipesT("coverage")}</h2>
            <p>
              {Object.entries(nutrition.coverage)
                .slice(0, 4)
                .map(([key, value]) => `${key}: ${value === null ? "–" : formatPercent(value, user.language)}`)
                .join(" · ")}
            </p>
            <p className="muted">{t("estimateNotice")}</p>
          </section>

          <section className="card">
            <h2>{t("save")}</h2>
            <p className="muted">{t("saveHint")}</p>
            {savedRecipeId ? (
              <p>
                <Link href={`/recipes/${savedRecipeId}`}>{t("openSavedCopy")}</Link>
              </p>
            ) : null}
            <SavePublicationForm id={publication.id} alreadySaved={Boolean(savedRecipeId)} />
          </section>

          {isAuthor ? (
            <section className="card">
              <h2>{t("authorTools")}</h2>
              <p className="muted">{t("withdrawHint")}</p>
              {publication.status === "PUBLISHED" ? (
                <WithdrawPublicationForm id={publication.id} recipeId={publication.sourceRecipeId ?? undefined} />
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}
