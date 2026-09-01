"use client";

import { useTranslations } from "next-intl";
import { AutoRefresh } from "@/components/auto-refresh";
import { queueRecipeImportAction, type RecipeImportDraft, type RecipeImportError } from "@/server/recipe-import-actions";
import { RecipeForm } from "../recipe-form";

/**
 * The extraction is queued, not awaited: a local model takes minutes, which no
 * form submission can hold open. So this is a plain form that navigates, and the
 * page it navigates to reports the state. `AutoRefresh` fills the draft in when
 * the worker is done, without the reader having to reload anything.
 */
export function NewRecipeWorkspace({
  draft,
  error,
  pending,
  failed,
  imageMaxMb,
}: {
  draft: RecipeImportDraft | null;
  error?: RecipeImportError;
  pending: boolean;
  failed: string | null;
  imageMaxMb: number;
}) {
  const t = useTranslations("recipes.import");

  return (
    <div className="stack">
      <section className="card" aria-labelledby="recipe-import-heading">
        <div className="card-head">
          <div>
            <h2 id="recipe-import-heading">{t("title")}</h2>
            <p className="muted" style={{ margin: 0 }}>{t("hint")}</p>
          </div>
          <span className="ai-badge">AI</span>
        </div>
        <form action={queueRecipeImportAction}>
          <div className="field"><label htmlFor="recipe-import-text">{t("text")}</label><textarea id="recipe-import-text" name="text" maxLength={5000} placeholder={t("textPlaceholder")} /></div>
          <div className="field"><label htmlFor="recipe-import-url">{t("url")}</label><input id="recipe-import-url" name="sourceUrl" type="url" placeholder="https://…" /></div>
          <div className="field"><label htmlFor="recipe-import-servings">{t("servings")}</label><input id="recipe-import-servings" name="servings" type="number" min="0.01" max="10000" step="0.01" defaultValue="1" required aria-describedby="recipe-import-servings-hint" /><span className="hint" id="recipe-import-servings-hint">{t("servingsHint")}</span></div>
          <div className="field"><label htmlFor="recipe-import-image">{t("image")}</label><input id="recipe-import-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" /><span className="hint">{t("imageHint", { maxMb: imageMaxMb })}</span></div>
          {error ? <div className="notice notice-error" role="alert">{t(`errors.${error}`)}</div> : null}
          <button className="btn btn-primary" disabled={pending}>{t("submit")}</button>
        </form>

        {pending ? (
          <div className="notice" style={{ marginTop: 14 }}>
            <span className="notice-icon" aria-hidden="true">i</span>
            <span>
              {t("queued")}
              <AutoRefresh />
            </span>
          </div>
        ) : null}

        {failed !== null ? (
          <div className="notice notice-error" role="alert" style={{ marginTop: 14 }}>
            <span className="notice-icon" aria-hidden="true">!</span>
            <span>
              {t("errors.extractionFailed")}
              {failed ? <span className="job-detail-break"> — {failed}</span> : null}
            </span>
          </div>
        ) : null}

        {draft?.unmatched.length ? (
          <div className="notice notice-warn" style={{ marginTop: 14 }}>{t("unmatched", { names: draft.unmatched.join(", ") })}</div>
        ) : null}
      </section>

      <RecipeForm
        key={draft ? JSON.stringify(draft) : "empty"}
        recipe={draft ? { ...draft, id: "", yieldWeightG: null, tags: [] } : undefined}
        createMode
      />
    </div>
  );
}
